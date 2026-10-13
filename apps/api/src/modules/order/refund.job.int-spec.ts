import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type Prisma,
  type RefundRequestKind,
  type RefundRequestStatus,
} from '@prisma/client';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import type {
  RefundParams,
  RefundResult,
} from '../../shared/payment/payment-gateway.interface';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService } from './order-status.service';
import { REFUND_PENDING_STALE_MS } from './refund-config';
import { RefundRequestActionService } from './refund-request-action.service';
import { RefundRequestService } from './refund-request.service';
import { RefundJob } from './refund.job';
import { RefundService } from './refund.service';

// Integration test trên DB dev THẬT: RefundJob (Week9.md 1.5/2.8) chạy end-to-end qua job.run() thật.
//  - Lượt 1: yêu cầu hủy quá hạn phản hồi của seller ⇒ tự duyệt (hủy đơn + kho + hoàn tiền, actor SYSTEM),
//    yêu cầu trả hàng quá hạn ⇒ chuyển Admin; không đụng yêu cầu chưa quá hạn / đã có người xử lý; thua race
//    với seller thì đơn chỉ hủy và hoàn tiền đúng một lần.
//  - Lượt 2: khoản hoàn PENDING bị bỏ dở ⇒ gọi lại cổng bằng cùng mã tham chiếu; hết REFUND_MAX_ATTEMPTS lần
//    mà cổng vẫn treo ⇒ FAILED cho Admin; không đụng khoản mới / khoản FAILED do cổng từ chối.
// Job thật quét TOÀN BỘ bảng, nên prisma đưa cho job bị khoanh vùng vào dữ liệu có tiền tố TAG của file này —
// nếu không, một yêu cầu quá hạn do tự test tay để lại trong DB dev sẽ bị job (và tiền) xử lý thật theo.
// Chạy: `pnpm test:int`.
const TAG = 'it-refund-job-';
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

describe('RefundJob (DB thật)', () => {
  const prisma = new PrismaClient();
  const fakeMail = createFakeMail();
  const orderStatusService = new OrderStatusService();
  const inventoryService = new InventoryService();
  const voucherUsageService = new VoucherUsageService();
  const mockProvider = new MockPaymentProvider();
  const paymentGateway = new PaymentGatewayService(
    new VnpayProvider(),
    mockProvider,
  );
  const orderEmailService = new OrderEmailService(
    prisma as unknown as PrismaService,
    fakeMail.mailService,
  );
  const refundRequestService = new RefundRequestService();
  const refundService = new RefundService(
    prisma as unknown as PrismaService,
    orderStatusService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
    refundRequestService,
    orderEmailService,
  );
  const actionService = new RefundRequestActionService(
    prisma as unknown as PrismaService,
    refundRequestService,
    refundService,
  );

  // Chỉ thấy yêu cầu / khoản hoàn của người dùng test (email bắt đầu bằng TAG). `where` gốc của job vẫn được
  // giữ nguyên và chạy trên DB thật — chỉ có thêm một ràng buộc AND để không chạm dữ liệu ngoài file này.
  const scopedPrisma = {
    refundRequest: {
      findMany: (args: Prisma.RefundRequestFindManyArgs) =>
        prisma.refundRequest.findMany({
          ...args,
          where: {
            AND: [args.where ?? {}, { user: { email: { startsWith: TAG } } }],
          },
        }),
    },
    paymentRefund: {
      findMany: (args: Prisma.PaymentRefundFindManyArgs) =>
        prisma.paymentRefund.findMany({
          ...args,
          where: {
            AND: [
              args.where ?? {},
              {
                payment: {
                  checkoutGroup: { user: { email: { startsWith: TAG } } },
                },
              },
            ],
          },
        }),
    },
  };
  const job = new RefundJob(
    scopedPrisma as unknown as PrismaService,
    actionService,
    refundService,
  );

  const originalEnv = {
    mock: process.env.PAYMENT_MOCK_ENABLED,
    fail: process.env.PAYMENT_MOCK_REFUND_FAIL,
    timeout: process.env.REFUND_GATEWAY_TIMEOUT_MS,
    maxAttempts: process.env.REFUND_MAX_ATTEMPTS,
  };

  beforeAll(async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
    delete process.env.REFUND_MAX_ATTEMPTS;
    await cleanupByTag(prisma, TAG);
  });

  afterEach(() => {
    delete process.env.REFUND_MAX_ATTEMPTS;
    if (originalEnv.timeout === undefined) {
      delete process.env.REFUND_GATEWAY_TIMEOUT_MS;
    } else {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = originalEnv.timeout;
    }
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('PAYMENT_MOCK_ENABLED', originalEnv.mock);
    restore('PAYMENT_MOCK_REFUND_FAIL', originalEnv.fail);
    restore('REFUND_MAX_ATTEMPTS', originalEnv.maxAttempts);
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // Đơn của một nhóm 1 đơn, dựng như luồng thật để lại: online ⇒ Payment SUCCESS (kho đã chốt), COD ⇒ Payment
  // PENDING không hạn.
  async function setupOrder(options: {
    method: Extract<PaymentMethod, 'VNPAY' | 'COD'>;
    status: OrderStatus;
    stock?: number;
    quantity?: number;
  }) {
    const isCod = options.method === 'COD';
    const quantity = options.quantity ?? 2;
    const stock = options.stock ?? 8;
    const total = 100_000 * quantity;

    const user = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    const base = await createShopWithProduct(prisma, TAG);
    const shop = await prisma.shop.findUniqueOrThrow({
      where: { id: base.shopId },
      select: { ownerId: true },
    });
    const variant = await createVariant(prisma, base, { stock });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: options.status,
        totalAmount: total,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: variant.id,
              quantity,
              priceAtPurchase: 100_000,
              productName: `${TAG}product`,
              sku: `SKU-${variant.id}`,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: {
          create: seedOrderHistory(options.status, { isCod }),
        },
      },
      select: { id: true },
    });
    const payment = await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: options.method,
        status: isCod ? 'PENDING' : 'SUCCESS',
        amount: total,
        txnRef:
          `${TAG.toUpperCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
        transactionId: isCod ? null : 'GW-TXN-1',
        paidAt: isCod ? null : new Date(Date.now() - 60_000),
        expiresAt: null,
      },
      select: { id: true },
    });
    return {
      userId: user.id,
      sellerUserId: shop.ownerId,
      shopId: base.shopId,
      groupId: group.id,
      orderId: order.id,
      variantId: variant.id,
      paymentId: payment.id,
      stock,
      quantity,
      total,
    };
  }

  type SeededOrder = Awaited<ReturnType<typeof setupOrder>>;

  // Yêu cầu của đơn kèm dòng thời gian khởi tạo; `respondBy` mặc định đã qua 1 giờ.
  async function seedRequest(
    order: SeededOrder,
    options: {
      kind?: RefundRequestKind;
      status?: RefundRequestStatus;
      respondBy?: Date;
    } = {},
  ) {
    const createdAt = new Date(Date.now() - 49 * HOUR_MS);
    const request = await prisma.refundRequest.create({
      data: {
        orderId: order.orderId,
        shopId: order.shopId,
        userId: order.userId,
        kind: options.kind ?? 'CANCEL',
        status: options.status ?? 'PENDING_SELLER',
        reasonCode: options.kind === 'RETURN' ? 'DAMAGED' : 'CHANGE_OF_MIND',
        sellerRespondBy: options.respondBy ?? new Date(Date.now() - HOUR_MS),
        statusChangedAt: createdAt,
        createdAt,
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: 'PENDING_SELLER',
              actorType: 'BUYER',
              actorId: order.userId,
              createdAt,
            },
          ],
        },
      },
      select: { id: true },
    });
    return request.id;
  }

  const stockOf = async (variantId: string) =>
    (
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      })
    ).stock;
  const orderStatusOf = async (id: string) =>
    (
      await prisma.order.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;
  const requestOf = (id: string) =>
    prisma.refundRequest.findUniqueOrThrow({
      where: { id },
      include: { history: { orderBy: { createdAt: 'asc' } } },
    });
  const paymentOf = (id: string) =>
    prisma.payment.findUniqueOrThrow({
      where: { id },
      select: { status: true, refundedAmount: true },
    });
  const refundsOf = (paymentId: string) =>
    prisma.paymentRefund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
  // Làm cũ `updatedAt` để khoản hoàn bị coi là "bỏ dở" (Prisma tôn trọng giá trị truyền tường minh cho @updatedAt).
  const makeStale = (refundId: string) =>
    prisma.paymentRefund.update({
      where: { id: refundId },
      data: {
        updatedAt: new Date(Date.now() - REFUND_PENDING_STALE_MS - 1000),
      },
    });

  // --- Lượt 1: yêu cầu quá hạn phản hồi của seller -----------------------------------------------

  describe('lượt 1 — yêu cầu quá hạn phản hồi của seller', () => {
    it('yêu cầu HỦY online quá hạn ⇒ tự duyệt: đơn CANCELLED, kho cộng lại, hoàn tiền SUCCEEDED, Payment REFUNDED, yêu cầu APPROVED bởi SYSTEM, người mua nhận email', async () => {
      const order = await setupOrder({ method: 'VNPAY', status: 'CONFIRMED' });
      const requestId = await seedRequest(order);

      await job.run();

      expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
      expect(await stockOf(order.variantId)).toBe(order.stock + order.quantity);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(order.total);

      const [refund] = await refundsOf(order.paymentId);
      expect(refund).toMatchObject({
        orderId: order.orderId,
        refundRequestId: requestId,
        status: 'SUCCEEDED',
        initiatedByType: 'SYSTEM',
        initiatedById: null,
        attempts: 1,
      });

      const request = await requestOf(requestId);
      expect(request.status).toBe('APPROVED');
      expect(request.history).toHaveLength(2);
      expect(request.history[1]).toMatchObject({
        fromStatus: 'PENDING_SELLER',
        toStatus: 'APPROVED',
        actorType: 'SYSTEM',
        actorId: null,
        note: null, // không chèn chuỗi mặc định làm "lý do"
      });

      const orderHistory = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.orderId, toStatus: 'CANCELLED' },
      });
      expect(orderHistory).toHaveLength(1);
      expect(orderHistory[0]).toMatchObject({
        fromStatus: 'CONFIRMED',
        actorType: 'SYSTEM',
        actorId: null,
      });
      expect(fakeMail.sent).toHaveLength(1);
    });

    it('yêu cầu HỦY đơn PACKED và đơn COD quá hạn cũng tự duyệt; COD không có PaymentRefund, Payment COD → CANCELLED', async () => {
      const packed = await setupOrder({ method: 'VNPAY', status: 'PACKED' });
      const cod = await setupOrder({ method: 'COD', status: 'CONFIRMED' });
      await seedRequest(packed);
      const codRequestId = await seedRequest(cod);

      await job.run();

      expect(await orderStatusOf(packed.orderId)).toBe('CANCELLED');
      expect(await orderStatusOf(cod.orderId)).toBe('CANCELLED');
      expect((await requestOf(codRequestId)).status).toBe('APPROVED');
      expect(await refundsOf(cod.paymentId)).toHaveLength(0);
      expect((await paymentOf(cod.paymentId)).status).toBe('CANCELLED');
      expect(await stockOf(cod.variantId)).toBe(cod.stock + cod.quantity);
    });

    it('yêu cầu TRẢ HÀNG quá hạn ⇒ chuyển Admin (ESCALATED) bởi SYSTEM, KHÔNG duyệt: đơn vẫn COMPLETED, không hoàn tiền, không cộng kho', async () => {
      const order = await setupOrder({ method: 'VNPAY', status: 'COMPLETED' });
      const requestId = await seedRequest(order, { kind: 'RETURN' });

      await job.run();

      expect(await orderStatusOf(order.orderId)).toBe('COMPLETED');
      expect(await refundsOf(order.paymentId)).toHaveLength(0);
      expect((await paymentOf(order.paymentId)).status).toBe('SUCCESS');
      expect(await stockOf(order.variantId)).toBe(order.stock);

      const request = await requestOf(requestId);
      expect(request.status).toBe('ESCALATED');
      expect(request.history.at(-1)).toMatchObject({
        fromStatus: 'PENDING_SELLER',
        toStatus: 'ESCALATED',
        actorType: 'SYSTEM',
        actorId: null,
        note: null,
      });
      // statusChangedAt = lúc chuyển lên sàn (hàng chờ Admin xếp theo mốc này).
      expect(request.statusChangedAt.getTime()).toBeGreaterThan(
        Date.now() - MIN_MS,
      );
      expect(fakeMail.sent).toHaveLength(0);
    });

    it('KHÔNG đụng: chưa quá hạn, seller đã từ chối, người mua đã rút', async () => {
      const notYet = await setupOrder({ method: 'VNPAY', status: 'CONFIRMED' });
      const rejected = await setupOrder({
        method: 'VNPAY',
        status: 'CONFIRMED',
      });
      const withdrawn = await setupOrder({
        method: 'VNPAY',
        status: 'CONFIRMED',
      });
      const notYetId = await seedRequest(notYet, {
        respondBy: new Date(Date.now() + HOUR_MS),
      });
      const rejectedId = await seedRequest(rejected, {
        status: 'REJECTED_BY_SELLER',
      });
      const withdrawnId = await seedRequest(withdrawn, {
        status: 'WITHDRAWN',
      });

      await job.run();

      for (const order of [notYet, rejected, withdrawn]) {
        expect(await orderStatusOf(order.orderId)).toBe('CONFIRMED');
        expect(await refundsOf(order.paymentId)).toHaveLength(0);
      }
      expect((await requestOf(notYetId)).status).toBe('PENDING_SELLER');
      expect((await requestOf(rejectedId)).status).toBe('REJECTED_BY_SELLER');
      expect((await requestOf(withdrawnId)).status).toBe('WITHDRAWN');
    });

    it('chạy job 2 LẦN LIÊN TIẾP — lượt 2 là no-op sạch: đúng 1 dòng APPROVED, đúng 1 khoản hoàn, kho cộng đúng 1 lần', async () => {
      const order = await setupOrder({ method: 'VNPAY', status: 'CONFIRMED' });
      const requestId = await seedRequest(order);

      await job.run();
      await job.run();

      const request = await requestOf(requestId);
      expect(
        request.history.filter((h) => h.toStatus === 'APPROVED'),
      ).toHaveLength(1);
      expect(await refundsOf(order.paymentId)).toHaveLength(1);
      expect(await stockOf(order.variantId)).toBe(order.stock + order.quantity);
    });

    it('RACE: seller bấm "Duyệt" ĐỒNG THỜI với job (5 vòng) — đơn hủy đúng 1 lần, đúng 1 khoản hoàn, kho cộng 1 lần, job không bao giờ ném', async () => {
      for (let round = 0; round < 5; round++) {
        const order = await setupOrder({
          method: 'VNPAY',
          status: 'CONFIRMED',
        });
        const requestId = await seedRequest(order);

        const results = await Promise.allSettled([
          actionService.approveForSeller(
            order.shopId,
            order.sellerUserId,
            requestId,
          ),
          job.run(),
        ]);

        // job.run() không ném; seller thua race thì nhận 409 (yêu cầu đã được hệ thống duyệt).
        expect(results[1].status).toBe('fulfilled');
        expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
        const request = await requestOf(requestId);
        expect(request.status).toBe('APPROVED');
        expect(
          request.history.filter((h) => h.toStatus === 'APPROVED'),
        ).toHaveLength(1);
        expect(await refundsOf(order.paymentId)).toHaveLength(1);
        expect(await stockOf(order.variantId)).toBe(
          order.stock + order.quantity,
        );
        expect((await paymentOf(order.paymentId)).status).toBe('REFUNDED');
      }
    });

    it('1 yêu cầu lệch dữ liệu (đơn đang SHIPPING nên không hủy được) chỉ bị log, KHÔNG chặn yêu cầu hợp lệ phía sau; yêu cầu lệch vẫn chờ seller', async () => {
      const broken = await setupOrder({ method: 'VNPAY', status: 'SHIPPING' });
      const healthy = await setupOrder({
        method: 'VNPAY',
        status: 'CONFIRMED',
      });
      // Quá hạn lâu hơn ⇒ job xử lý yêu cầu lệch TRƯỚC.
      const brokenId = await seedRequest(broken, {
        respondBy: new Date(Date.now() - 5 * HOUR_MS),
      });
      const healthyId = await seedRequest(healthy);

      await expect(job.run()).resolves.toBeUndefined();

      expect((await requestOf(brokenId)).status).toBe('PENDING_SELLER');
      expect(await orderStatusOf(broken.orderId)).toBe('SHIPPING');
      expect((await requestOf(healthyId)).status).toBe('APPROVED');
      expect(await orderStatusOf(healthy.orderId)).toBe('CANCELLED');

      // Yêu cầu lệch sẽ bị job thử lại và log lỗi ở MỌI lượt sau — rút nó để các test khác trong file không ồn.
      await prisma.refundRequest.update({
        where: { id: brokenId },
        data: { status: 'WITHDRAWN' },
      });
    });
  });

  // --- Lượt 2: khoản hoàn PENDING bị bỏ dở -------------------------------------------------------

  describe('lượt 2 — khoản hoàn tiền PENDING bị bỏ dở', () => {
    // Dựng đúng hiện trường "cổng không trả lời": hủy ngay một đơn online, lần gọi cổng đầu tiên lỗi mạng ⇒
    // đơn đã CANCELLED, khoản hoàn ở lại PENDING (attempts = 1), Payment còn SUCCESS.
    async function setupStuckRefund() {
      const order = await setupOrder({ method: 'VNPAY', status: 'PENDING' });
      const refundSpy = jest
        .spyOn(mockProvider, 'refund')
        .mockRejectedValueOnce(new Error('network down'));
      const { refund } = await refundService.cancelOrderWithRefund(
        { type: 'BUYER', id: order.userId },
        order.orderId,
      );
      expect(refund?.status).toBe('PENDING');
      refundSpy.mockClear();
      return { order, refundId: refund?.id ?? '', refundSpy };
    }

    it('PENDING bỏ dở còn lượt thử ⇒ job gọi cổng lại bằng CÙNG dòng: SUCCEEDED, attempts tăng, Payment REFUNDED', async () => {
      const { order, refundId } = await setupStuckRefund();
      await makeStale(refundId);

      await job.run();

      const [refund] = await refundsOf(order.paymentId);
      expect(refund).toMatchObject({
        id: refundId,
        status: 'SUCCEEDED',
        attempts: 2,
      });
      expect(refund.gatewayRef).toMatch(/^MOCK-REFUND-/);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(order.total);
      expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
    });

    it('lần gọi đầu cổng ĐÃ nhận nhưng mất phản hồi ⇒ job gọi lại bằng CÙNG mã tham chiếu: cổng chỉ thấy một mã, sổ cái ghi hoàn đúng MỘT lần', async () => {
      const order = await setupOrder({ method: 'VNPAY', status: 'PENDING' });
      const original = mockProvider.refund.bind(mockProvider) as (
        params: RefundParams,
      ) => Promise<RefundResult>;
      const refs: string[] = [];
      const refundSpy = jest
        .spyOn(mockProvider, 'refund')
        .mockImplementationOnce(async (params: RefundParams) => {
          refs.push(params.refundRef);
          await original(params); // cổng đã hoàn xong…
          throw new Error('response lost'); // …nhưng phản hồi không về tới chúng ta
        })
        .mockImplementation((params: RefundParams) => {
          refs.push(params.refundRef);
          return original(params);
        });
      const { refund } = await refundService.cancelOrderWithRefund(
        { type: 'BUYER', id: order.userId },
        order.orderId,
      );
      expect(refund?.status).toBe('PENDING');
      await makeStale(refund?.id ?? '');

      await job.run();

      expect(refundSpy).toHaveBeenCalledTimes(2);
      expect(new Set(refs).size).toBe(1);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(order.total); // một lần, không gấp đôi
      expect(await refundsOf(order.paymentId)).toHaveLength(1);
    });

    it('PENDING còn MỚI (dưới 5 phút — lần gọi cổng có thể vẫn đang chạy) ⇒ job không đụng, không gọi cổng', async () => {
      const { order, refundId, refundSpy } = await setupStuckRefund();

      await job.run();

      expect(refundSpy).not.toHaveBeenCalled();
      const [refund] = await refundsOf(order.paymentId);
      expect(refund).toMatchObject({
        id: refundId,
        status: 'PENDING',
        attempts: 1,
      });
      expect((await paymentOf(order.paymentId)).status).toBe('SUCCESS');
    });

    it('cổng treo MỌI lần ⇒ đúng REFUND_MAX_ATTEMPTS (3) lần gọi rồi FAILED kèm lý do; Payment còn SUCCESS, đơn vẫn CANCELLED; FAILED không bị thử lại nữa', async () => {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = '50';
      const order = await setupOrder({ method: 'VNPAY', status: 'PENDING' });
      const refundSpy = jest
        .spyOn(mockProvider, 'refund')
        .mockImplementation(() => new Promise(() => undefined));
      const { refund } = await refundService.cancelOrderWithRefund(
        { type: 'BUYER', id: order.userId },
        order.orderId,
      );
      const refundId = refund?.id ?? '';
      expect(refund?.status).toBe('PENDING');

      // Lượt 2 và 3 của job: vẫn PENDING (cổng treo), mỗi lần tăng attempts.
      for (const expectedAttempts of [2, 3]) {
        await makeStale(refundId);
        await job.run();
        const [current] = await refundsOf(order.paymentId);
        expect(current).toMatchObject({
          status: 'PENDING',
          attempts: expectedAttempts,
        });
      }
      expect(refundSpy).toHaveBeenCalledTimes(3);

      // Lượt kế: đã hết lượt ⇒ FAILED, KHÔNG gọi cổng lần thứ 4.
      await makeStale(refundId);
      await job.run();
      const [failed] = await refundsOf(order.paymentId);
      expect(failed).toMatchObject({ status: 'FAILED', attempts: 3 });
      expect(failed.failureReason).toMatch(/retries exhausted/i);
      expect(refundSpy).toHaveBeenCalledTimes(3);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('SUCCESS');
      expect(Number(payment.refundedAmount)).toBe(0);
      expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');

      // FAILED là cuối của đường tự động: job không thử lại (Admin mới được).
      await makeStale(refundId);
      await job.run();
      expect(refundSpy).toHaveBeenCalledTimes(3);
      expect((await refundsOf(order.paymentId))[0].status).toBe('FAILED');
    });

    it('REFUND_MAX_ATTEMPTS đọc lúc chạy: đặt 1 ⇒ khoản bỏ dở (đã thử 1 lần) bị đánh FAILED ngay, không gọi cổng lại', async () => {
      process.env.REFUND_MAX_ATTEMPTS = '1';
      const { order, refundId, refundSpy } = await setupStuckRefund();
      await makeStale(refundId);

      await job.run();

      expect(refundSpy).not.toHaveBeenCalled();
      expect((await refundsOf(order.paymentId))[0].status).toBe('FAILED');
    });

    it('hết lượt nhưng updatedAt còn mới (Admin vừa thử lại, lần gọi cổng đang chạy) ⇒ KHÔNG bị đánh FAILED giữa chừng', async () => {
      const { order, refundId } = await setupStuckRefund();
      await prisma.paymentRefund.update({
        where: { id: refundId },
        data: { attempts: 3 }, // updatedAt tự làm mới = bây giờ
      });

      await job.run();

      expect((await refundsOf(order.paymentId))[0]).toMatchObject({
        status: 'PENDING',
        attempts: 3,
      });
    });

    it('HAI instance API chạy job ĐỒNG THỜI (3 vòng, mỗi vòng cả hai lượt): yêu cầu quá hạn chỉ duyệt một lần, khoản bỏ dở chỉ hoàn một lần, không ai ném lỗi', async () => {
      const otherInstance = new RefundJob(
        scopedPrisma as unknown as PrismaService,
        actionService,
        refundService,
      );

      for (let round = 0; round < 3; round++) {
        const overdue = await setupOrder({
          method: 'VNPAY',
          status: 'CONFIRMED',
        });
        const requestId = await seedRequest(overdue);
        const { order: stuck, refundId } = await setupStuckRefund();
        await makeStale(refundId);

        const results = await Promise.allSettled([
          job.run(),
          otherInstance.run(),
        ]);

        expect(results.map((r) => r.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
        const request = await requestOf(requestId);
        expect(request.status).toBe('APPROVED');
        expect(
          request.history.filter((h) => h.toStatus === 'APPROVED'),
        ).toHaveLength(1);
        expect(await refundsOf(overdue.paymentId)).toHaveLength(1);
        expect(await stockOf(overdue.variantId)).toBe(
          overdue.stock + overdue.quantity,
        );

        const stuckPayment = await paymentOf(stuck.paymentId);
        expect(stuckPayment.status).toBe('REFUNDED');
        expect(Number(stuckPayment.refundedAmount)).toBe(stuck.total);
        const [stuckRefund] = await refundsOf(stuck.paymentId);
        expect(stuckRefund.status).toBe('SUCCEEDED');
      }
    });

    it('failExhaustedRefund tự bảo vệ dù danh sách ứng viên đã cũ: chưa đủ lượt hoặc updatedAt còn mới (lần thử lại đang chạy) ⇒ false và vẫn PENDING; đủ cả hai ⇒ FAILED đúng một lần', async () => {
      const { order, refundId } = await setupStuckRefund();
      const statusNow = async () =>
        (await refundsOf(order.paymentId))[0].status;

      // Mới thử 1 lần (attempts = 1 < 3) dù đã bỏ dở lâu.
      await makeStale(refundId);
      await expect(
        refundService.failExhaustedRefund(refundId, 3),
      ).resolves.toBe(false);
      expect(await statusNow()).toBe('PENDING');

      // Đủ lượt nhưng updatedAt vừa được làm mới (vd Admin vừa bấm thử lại): không đánh FAILED giữa chừng.
      await prisma.paymentRefund.update({
        where: { id: refundId },
        data: { attempts: 3 },
      });
      await expect(
        refundService.failExhaustedRefund(refundId, 3),
      ).resolves.toBe(false);
      expect(await statusNow()).toBe('PENDING');

      // Đủ lượt VÀ bỏ dở đủ lâu ⇒ FAILED; gọi lại là no-op.
      await makeStale(refundId);
      await expect(
        refundService.failExhaustedRefund(refundId, 3),
      ).resolves.toBe(true);
      expect(await statusNow()).toBe('FAILED');
      await expect(
        refundService.failExhaustedRefund(refundId, 3),
      ).resolves.toBe(false);
    });

    it('khoản FAILED do cổng TỪ CHỐI không được job thử lại tự động', async () => {
      const { order, refundId, refundSpy } = await setupStuckRefund();
      await prisma.paymentRefund.update({
        where: { id: refundId },
        data: {
          status: 'FAILED',
          failureReason: 'Gateway said no',
          updatedAt: new Date(Date.now() - 2 * HOUR_MS),
        },
      });

      await job.run();

      expect(refundSpy).not.toHaveBeenCalled();
      expect((await refundsOf(order.paymentId))[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'Gateway said no',
      });
    });
  });
});
