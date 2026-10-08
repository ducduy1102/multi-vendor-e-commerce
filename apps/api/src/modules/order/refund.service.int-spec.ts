import {
  PrismaClient,
  type OrderStatus,
  type PaymentStatus,
} from '@prisma/client';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
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
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { OrderActionService } from './order-action.service';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService, type OrderActor } from './order-status.service';
import { PaymentService } from './payment.service';
import { RefundRequestService } from './refund-request.service';
import { RefundService } from './refund.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh lõi hủy/hoàn tiền (Week9.md 2.5) đúng
// ở mức mock-tx không chứng minh được — SQL thô khoá Payment / cộng refunded_amount, CHECK DB, khoá hàng thật
// tuần tự hoá các giao dịch đồng thời mà không deadlock. Cổng thanh toán là MockPaymentProvider thật (bật bằng
// PAYMENT_MOCK_ENABLED). Các race còn lại (hủy vs IPN trễ, 2 yêu cầu duyệt đồng thời...) bổ sung ở 2.13.
// Chạy: `pnpm test:int`.
const TAG = 'it-refund-';

const BUYER = (id: string): OrderActor => ({ type: 'BUYER', id });
const SELLER: OrderActor = { type: 'SELLER', id: 'seller-it' };
const ADMIN: OrderActor = { type: 'ADMIN', id: 'admin-it' };

interface OrderSpec {
  status: OrderStatus;
  price?: number;
  quantity?: number;
  // Tồn kho SAU khi đã chốt (đơn đã thanh toán / COD đã trừ kho lúc đặt).
  stock?: number;
  discount?: number;
}

describe('RefundService (DB thật)', () => {
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
  const service = new RefundService(
    prisma as unknown as PrismaService,
    orderStatusService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
    new RefundRequestService(),
    orderEmailService,
  );
  const paymentService = new PaymentService(
    prisma as unknown as PrismaService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
    orderStatusService,
    orderEmailService,
  );
  const actionService = new OrderActionService(
    prisma as unknown as PrismaService,
    orderStatusService,
    paymentService,
    orderEmailService,
    service,
  );

  const originalEnv = {
    mock: process.env.PAYMENT_MOCK_ENABLED,
    fail: process.env.PAYMENT_MOCK_REFUND_FAIL,
    timeout: process.env.REFUND_GATEWAY_TIMEOUT_MS,
  };

  beforeAll(async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
    await cleanupByTag(prisma, TAG);
  });

  afterEach(() => {
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
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
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // Dựng nhóm đúng như luồng thật để lại: đơn online đã thanh toán (Payment SUCCESS, kho đã chốt) hoặc đơn
  // COD (đơn PENDING, kho đã chốt lúc đặt, Payment COD PENDING không hạn). `discount > 0` ⇒ có VoucherUsage.
  async function setupGroup(options: {
    method: 'VNPAY' | 'COD';
    orders: OrderSpec[];
    codPaymentStatus?: PaymentStatus;
  }) {
    const isCod = options.method === 'COD';
    const user = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    const hasVoucher = options.orders.some((o) => (o.discount ?? 0) > 0);
    const voucher = hasVoucher
      ? await prisma.voucher.create({
          data: {
            code: `${TAG.toUpperCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
            type: 'FIXED',
            value: 10_000,
            usedCount: 1,
          },
          select: { id: true },
        })
      : null;

    const orders: {
      id: string;
      variantId: string;
      quantity: number;
      stock: number;
      total: number;
    }[] = [];
    let amount = 0;
    for (const spec of options.orders) {
      const price = spec.price ?? 100_000;
      const quantity = spec.quantity ?? 2;
      const stock = spec.stock ?? 10;
      const discount = spec.discount ?? 0;
      const total = price * quantity - discount;
      amount += total;

      const base = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, base, { stock });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status: spec.status,
          totalAmount: total,
          discountAmount: discount,
          voucherId: discount > 0 ? voucher?.id : undefined,
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
                priceAtPurchase: price,
                productName: `${TAG}product`,
                sku: `SKU-${variant.id}`,
                variantLabel: null,
                imageUrl: null,
              },
            ],
          },
          statusHistory: { create: seedOrderHistory(spec.status, { isCod }) },
        },
        select: { id: true },
      });
      orders.push({
        id: order.id,
        variantId: variant.id,
        quantity,
        stock,
        total,
      });
    }

    const payment = await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: options.method,
        status: isCod ? (options.codPaymentStatus ?? 'PENDING') : 'SUCCESS',
        amount,
        txnRef:
          `${TAG.toUpperCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
        transactionId: isCod ? null : 'GW-TXN-1',
        paidAt: isCod ? null : new Date(Date.now() - 60_000),
        expiresAt: null,
      },
      select: { id: true },
    });
    if (voucher) {
      await prisma.voucherUsage.create({
        data: {
          voucherId: voucher.id,
          userId: user.id,
          checkoutGroupId: group.id,
          discountAmount: options.orders.reduce(
            (sum, o) => sum + (o.discount ?? 0),
            0,
          ),
        },
      });
    }
    return {
      userId: user.id,
      groupId: group.id,
      orders,
      paymentId: payment.id,
      amount,
      voucherId: voucher?.id ?? null,
    };
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
  const paymentOf = (id: string) =>
    prisma.payment.findUniqueOrThrow({
      where: { id },
      select: { status: true, refundedAmount: true, paidAt: true },
    });
  const refundsOf = (paymentId: string) =>
    prisma.paymentRefund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
  const voucherState = async (voucherId: string) => {
    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucherId },
      select: { usedCount: true },
    });
    const usage = await prisma.voucherUsage.findFirstOrThrow({
      where: { voucherId },
      select: { releasedAt: true },
    });
    return {
      usedCount: voucher.usedCount,
      released: usage.releasedAt !== null,
    };
  };

  describe('đơn online đã thanh toán — hủy NGAY (PENDING)', () => {
    it('hủy → kho cộng lại, khoản hoàn SUCCEEDED, Payment REFUNDED, timeline có actor + lý do, email báo "đang hoàn"', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING', quantity: 2, stock: 8 }],
      });

      const result = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
        { reason: 'Đặt nhầm' },
      );

      expect(result.refund).toMatchObject({
        status: 'SUCCEEDED',
        amount: String(g.amount),
      });
      expect(await orderStatusOf(g.orders[0].id)).toBe('CANCELLED');
      expect(await stockOf(g.orders[0].variantId)).toBe(10); // 8 + 2
      const payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(g.amount);

      const [refund] = await refundsOf(g.paymentId);
      expect(refund).toMatchObject({
        orderId: g.orders[0].id,
        status: 'SUCCEEDED',
        initiatedByType: 'BUYER',
        initiatedById: g.userId,
        reason: 'Đặt nhầm',
        attempts: 1,
      });
      expect(refund.gatewayRef).toMatch(/^MOCK-REFUND-[0-9a-f]{32}$/);
      expect(refund.completedAt).not.toBeNull();

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: g.orders[0].id, toStatus: 'CANCELLED' },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: 'PENDING',
        actorType: 'BUYER',
        actorId: g.userId,
        note: 'Đặt nhầm',
      });

      expect(fakeMail.sent).toHaveLength(1);
      expect(fakeMail.sent[0].html).toContain('đang hoàn');
      expect(fakeMail.sent[0].html).not.toContain('đã hoàn');
    });

    it('trạng thái nhóm sau hủy+hoàn là CANCELLED (không PAID_AFTER_EXPIRY)', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING' }],
      });

      await service.cancelOrderWithRefund(BUYER(g.userId), g.orders[0].id);

      const view = await paymentService.getCheckoutGroup(g.userId, g.groupId);
      expect(view.status).toBe('CANCELLED');
    });

    it('nhóm 2 đơn hủy lần lượt: hủy đơn thứ nhất ⇒ Payment vẫn SUCCESS (hoàn một phần) + GIỮ voucher; hủy đơn thứ hai ⇒ Payment REFUNDED + voucher được trả', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [
          { status: 'PENDING', price: 100_000, quantity: 1, discount: 10_000 },
          { status: 'PENDING', price: 50_000, quantity: 2, discount: 10_000 },
        ],
      });

      await service.cancelOrderWithRefund(BUYER(g.userId), g.orders[0].id);

      let payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('SUCCESS');
      expect(Number(payment.refundedAmount)).toBe(g.orders[0].total);
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 1,
        released: false,
      });
      expect(
        (await paymentService.getCheckoutGroup(g.userId, g.groupId)).status,
      ).toBe('PAID');

      await service.cancelOrderWithRefund(BUYER(g.userId), g.orders[1].id);

      payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(g.amount);
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 0,
        released: true,
      });
      expect(await refundsOf(g.paymentId)).toHaveLength(2);
    });

    it('2 đơn cùng nhóm hủy ĐỒNG THỜI (5 vòng): không deadlock, tổng hoàn đúng bằng số đã thu, voucher trả đúng 1 lần', async () => {
      for (let round = 0; round < 5; round++) {
        const g = await setupGroup({
          method: 'VNPAY',
          orders: [
            {
              status: 'PENDING',
              price: 100_000,
              quantity: 1,
              discount: 10_000,
            },
            { status: 'PENDING', price: 50_000, quantity: 2, discount: 10_000 },
          ],
        });

        await Promise.all(
          g.orders.map((o) =>
            service.cancelOrderWithRefund(BUYER(g.userId), o.id),
          ),
        );

        const payment = await paymentOf(g.paymentId);
        expect(payment.status).toBe('REFUNDED');
        expect(Number(payment.refundedAmount)).toBe(g.amount);
        expect(await voucherState(g.voucherId!)).toEqual({
          usedCount: 0,
          released: true,
        });
        for (const o of g.orders) {
          expect(await stockOf(o.variantId)).toBe(o.stock + o.quantity);
        }
      }
    });

    it('cùng một đơn bị hủy 2 lần đồng thời ⇒ đúng một bên thắng; kho cộng đúng 1 lần, hoàn tiền đúng 1 lần', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING', quantity: 2, stock: 8 }],
      });

      const results = await Promise.allSettled([
        service.cancelOrderWithRefund(BUYER(g.userId), g.orders[0].id),
        service.cancelOrderWithRefund(SELLER, g.orders[0].id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected');
      expect(failure?.reason).toMatchObject({
        code: expect.stringMatching(/^ORDER_/) as string,
      });
      expect(await stockOf(g.orders[0].variantId)).toBe(10);
      expect(await refundsOf(g.paymentId)).toHaveLength(1);
    });

    it.each(['AWAITING_PAYMENT', 'SHIPPING', 'COMPLETED'] as const)(
      'đơn %s không hủy được ⇒ 409 ORDER_INVALID_TRANSITION, DB không đổi',
      async (status) => {
        const g = await setupGroup({
          method: 'VNPAY',
          orders: [{ status, stock: 8 }],
        });

        await expectAppException(
          service.cancelOrderWithRefund(BUYER(g.userId), g.orders[0].id),
          { status: 409, code: 'ORDER_INVALID_TRANSITION' },
        );
        expect(await orderStatusOf(g.orders[0].id)).toBe(status);
        expect(await stockOf(g.orders[0].variantId)).toBe(8);
        expect(await refundsOf(g.paymentId)).toHaveLength(0);
      },
    );
  });

  describe('cổng hoàn tiền lỗi / chậm', () => {
    it('cổng TỪ CHỐI: đơn VẪN hủy (kho + voucher đúng), khoản hoàn FAILED kèm lý do, Payment còn SUCCESS; Admin thử lại ⇒ SUCCEEDED; thử lại lần 2 ⇒ 409, không hoàn thêm', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING', quantity: 2, stock: 8 }],
      });

      const result = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
      );

      expect(result.refund?.status).toBe('FAILED');
      expect(await orderStatusOf(g.orders[0].id)).toBe('CANCELLED');
      expect(await stockOf(g.orders[0].variantId)).toBe(10);
      let payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('SUCCESS');
      expect(Number(payment.refundedAmount)).toBe(0);
      const [failed] = await refundsOf(g.paymentId);
      expect(failed.failureReason).toContain('PAYMENT_MOCK_REFUND_FAIL');

      delete process.env.PAYMENT_MOCK_REFUND_FAIL;
      const retried = await service.retryRefund(ADMIN, failed.id);

      expect(retried.status).toBe('SUCCEEDED');
      payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(g.amount);
      const rows = await refundsOf(g.paymentId);
      expect(rows).toHaveLength(1); // dùng lại CÙNG dòng
      expect(rows[0].attempts).toBe(2);

      await expectAppException(service.retryRefund(ADMIN, failed.id), {
        status: 409,
        code: 'PAYMENT_REFUND_NOT_RETRYABLE',
      });
      expect(Number((await paymentOf(g.paymentId)).refundedAmount)).toBe(
        g.amount,
      );
    });

    it('cổng QUÁ HẠN ⇒ PENDING, request vẫn xong; nhóm báo CANCELLED (không PAID_AFTER_EXPIRY); chạy lại CÙNG mã tham chiếu ⇒ SUCCEEDED, tiền cộng 1 lần', async () => {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = '50';
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING', quantity: 1, stock: 8 }],
      });
      const refundSpy = jest
        .spyOn(mockProvider, 'refund')
        .mockImplementationOnce(() => new Promise(() => undefined));

      const result = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
      );

      expect(result.refund?.status).toBe('PENDING');
      expect((await paymentOf(g.paymentId)).status).toBe('SUCCESS');
      expect(
        (await paymentService.getCheckoutGroup(g.userId, g.groupId)).status,
      ).toBe('CANCELLED');

      const refundId = result.refund!.id;
      const retried = await service.executeRefund(refundId);

      expect(retried.status).toBe('SUCCEEDED');
      const refs = refundSpy.mock.calls.map(([params]) => params.refundRef);
      expect(refs).toEqual([
        refundId.replace(/-/g, ''),
        refundId.replace(/-/g, ''),
      ]);
      expect(Number((await paymentOf(g.paymentId)).refundedAmount)).toBe(
        g.amount,
      );
    });

    it('finaliseRefund SUCCESS gọi ĐỒNG THỜI nhiều lần ⇒ chỉ cộng tiền vào Payment đúng 1 lần (idempotent)', async () => {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = '50';
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING' }],
      });
      jest
        .spyOn(mockProvider, 'refund')
        .mockImplementationOnce(() => new Promise(() => undefined));
      const { refund } = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
      );

      await Promise.all(
        [1, 2, 3, 4].map(() =>
          service.finaliseRefund(refund!.id, {
            outcome: 'SUCCESS',
            gatewayRef: 'GW-1',
            failureReason: null,
          }),
        ),
      );

      const payment = await paymentOf(g.paymentId);
      expect(Number(payment.refundedAmount)).toBe(g.amount);
      expect(payment.status).toBe('REFUNDED');
    });

    it('bất biến DB: không bao giờ cộng quá số đã thu — khoản hoàn vượt amount bị từ chối, giữ nguyên PENDING (rollback)', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'CANCELLED' }],
      });
      const overshoot = await prisma.paymentRefund.create({
        data: {
          paymentId: g.paymentId,
          amount: g.amount + 1,
          status: 'PENDING',
          initiatedByType: 'ADMIN',
        },
      });

      await expectAppException(
        service.finaliseRefund(overshoot.id, {
          outcome: 'SUCCESS',
          gatewayRef: 'GW-X',
          failureReason: null,
        }),
        { status: 409, code: 'PAYMENT_NOT_REFUNDABLE' },
      );

      const after = await prisma.paymentRefund.findUniqueOrThrow({
        where: { id: overshoot.id },
      });
      expect(after.status).toBe('PENDING');
      expect(Number((await paymentOf(g.paymentId)).refundedAmount)).toBe(0);
    });

    it('Admin ghi nhận hoàn THỦ CÔNG: FAILED → SUCCEEDED "MANUAL:<mã>", Payment REFUNDED; gọi lại cùng mã không cộng lần hai', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING' }],
      });
      const { refund } = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
      );
      expect(refund?.status).toBe('FAILED');

      const first = await service.markRefundCompleted(
        ADMIN,
        refund!.id,
        'VNP-778899',
      );
      const second = await service.markRefundCompleted(
        ADMIN,
        refund!.id,
        'VNP-778899',
      );

      expect(first.status).toBe('SUCCEEDED');
      expect(second.status).toBe('SUCCEEDED');
      const [row] = await refundsOf(g.paymentId);
      expect(row.gatewayRef).toBe('MANUAL:VNP-778899');
      const payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(g.amount);
    });
  });

  describe('đơn COD — không có tiền qua cổng', () => {
    it('hủy hết nhóm COD ⇒ Payment CANCELLED (không paidAt, không kẹt PENDING), KHÔNG có PaymentRefund, kho cộng lại, voucher trả; hủy đơn đầu thì Payment còn PENDING + giữ voucher', async () => {
      const g = await setupGroup({
        method: 'COD',
        orders: [
          { status: 'PENDING', quantity: 1, stock: 5, discount: 10_000 },
          { status: 'PENDING', quantity: 3, stock: 5, discount: 10_000 },
        ],
      });

      const first = await service.cancelOrderWithRefund(
        BUYER(g.userId),
        g.orders[0].id,
      );

      expect(first.refund).toBeNull();
      expect((await paymentOf(g.paymentId)).status).toBe('PENDING');
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 1,
        released: false,
      });

      await service.cancelOrderWithRefund(BUYER(g.userId), g.orders[1].id);

      const payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('CANCELLED');
      expect(payment.paidAt).toBeNull();
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 0,
        released: true,
      });
      expect(await stockOf(g.orders[0].variantId)).toBe(6);
      expect(await stockOf(g.orders[1].variantId)).toBe(8);
      expect(await refundsOf(g.paymentId)).toHaveLength(0);
      expect(
        (await paymentService.getCheckoutGroup(g.userId, g.groupId)).status,
      ).toBe('CANCELLED');
    });

    it('2 đơn COD cùng nhóm hủy ĐỒNG THỜI qua RefundService (5 vòng): không write skew — Payment luôn CANCELLED và voucher luôn được trả', async () => {
      for (let round = 0; round < 5; round++) {
        const g = await setupGroup({
          method: 'COD',
          orders: [
            { status: 'PENDING', discount: 10_000 },
            { status: 'PENDING', discount: 10_000 },
          ],
        });

        await Promise.all(
          g.orders.map((o) =>
            service.cancelOrderWithRefund(BUYER(g.userId), o.id),
          ),
        );

        expect((await paymentOf(g.paymentId)).status).toBe('CANCELLED');
        expect(await voucherState(g.voucherId!)).toEqual({
          usedCount: 0,
          released: true,
        });
      }
    });

    it('qua OrderActionService.reject (uỷ quyền RefundService): 2 đơn COD cùng nhóm bị shop từ chối ĐỒNG THỜI (5 vòng) — cũng không write skew nhờ khoá cả nhóm', async () => {
      for (let round = 0; round < 5; round++) {
        const g = await setupGroup({
          method: 'COD',
          orders: [
            { status: 'PENDING', discount: 10_000 },
            { status: 'PENDING', discount: 10_000 },
          ],
        });
        const shops = await prisma.order.findMany({
          where: { checkoutGroupId: g.groupId },
          select: { id: true, shopId: true },
        });

        await Promise.all(
          shops.map((o) =>
            actionService.reject(o.shopId, 'seller-it', o.id, 'Hết hàng'),
          ),
        );

        expect((await paymentOf(g.paymentId)).status).toBe('CANCELLED');
        expect(await voucherState(g.voucherId!)).toEqual({
          usedCount: 0,
          released: true,
        });
      }
    });

    it('nhóm COD có đơn đã COMPLETED: hủy đơn còn lại ⇒ Payment COD → SUCCESS (đã thu), voucher GIỮ (đơn COMPLETED vẫn hưởng giảm)', async () => {
      const g = await setupGroup({
        method: 'COD',
        orders: [
          { status: 'COMPLETED', discount: 10_000 },
          { status: 'PENDING', discount: 10_000 },
        ],
      });

      await service.cancelOrderWithRefund(BUYER(g.userId), g.orders[1].id);

      const payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('SUCCESS');
      expect(payment.paidAt).not.toBeNull();
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 1,
        released: false,
      });
    });
  });

  describe('trả hàng SAU giao (RETURN)', () => {
    it('online: COMPLETED → REFUNDED, hoàn tiền, KHÔNG cộng kho, KHÔNG trả voucher', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [
          { status: 'COMPLETED', quantity: 2, stock: 8, discount: 10_000 },
        ],
      });

      const result = await service.refundReturnedOrder(ADMIN, g.orders[0].id, {
        reason: 'Hàng lỗi',
      });

      expect(result.refund?.status).toBe('SUCCEEDED');
      expect(await orderStatusOf(g.orders[0].id)).toBe('REFUNDED');
      expect(await stockOf(g.orders[0].variantId)).toBe(8);
      expect(await voucherState(g.voucherId!)).toEqual({
        usedCount: 1,
        released: false,
      });
      const payment = await paymentOf(g.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(g.amount);
      expect(fakeMail.sent).toHaveLength(0); // email hoàn tiền: 5.3
      expect(
        (await paymentService.getCheckoutGroup(g.userId, g.groupId)).status,
      ).toBe('CANCELLED');
    });

    it('COD: COMPLETED → REFUNDED, Payment COD giữ SUCCESS (tiền mặt đã thu rồi hoàn ngoài hệ thống), không có PaymentRefund', async () => {
      const g = await setupGroup({
        method: 'COD',
        codPaymentStatus: 'SUCCESS',
        orders: [{ status: 'COMPLETED' }],
      });

      const result = await service.refundReturnedOrder(SELLER, g.orders[0].id);

      expect(result.refund).toBeNull();
      expect(await orderStatusOf(g.orders[0].id)).toBe('REFUNDED');
      expect((await paymentOf(g.paymentId)).status).toBe('SUCCESS');
      expect(await refundsOf(g.paymentId)).toHaveLength(0);
    });
  });

  describe('đóng yêu cầu hủy/trả hàng cùng giao dịch', () => {
    async function createRequest(
      g: Awaited<ReturnType<typeof setupGroup>>,
      kind: 'CANCEL' | 'RETURN',
      status: 'PENDING_SELLER' | 'ESCALATED' | 'WITHDRAWN',
    ) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: g.orders[0].id },
        select: { shopId: true },
      });
      return prisma.refundRequest.create({
        data: {
          orderId: g.orders[0].id,
          shopId: order.shopId,
          userId: g.userId,
          kind,
          status,
          reasonCode: 'CHANGE_OF_MIND',
          sellerRespondBy: new Date(Date.now() + 3_600_000),
        },
        select: { id: true },
      });
    }

    it('seller tự hủy đơn CONFIRMED khi buyer đang xin hủy ⇒ yêu cầu APPROVED (history actor SELLER), khoản hoàn gắn refundRequestId, email "theo yêu cầu của bạn"', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'CONFIRMED' }],
      });
      const request = await createRequest(g, 'CANCEL', 'PENDING_SELLER');

      await service.cancelOrderWithRefund(SELLER, g.orders[0].id, {
        reason: 'Hết hàng',
      });

      const saved = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { history: true },
      });
      expect(saved.status).toBe('APPROVED');
      expect(saved.history).toHaveLength(1);
      expect(saved.history[0]).toMatchObject({
        fromStatus: 'PENDING_SELLER',
        toStatus: 'APPROVED',
        actorType: 'SELLER',
        note: 'Hết hàng',
      });
      const [refund] = await refundsOf(g.paymentId);
      expect(refund.refundRequestId).toBe(request.id);
      expect(fakeMail.sent[0].html).toContain('theo yêu cầu của bạn');
    });

    it('yêu cầu đã lên sàn (ESCALATED) được seller nhượng bộ đóng bằng việc tự hủy đơn', async () => {
      const g = await setupGroup({
        method: 'COD',
        orders: [{ status: 'PACKED' }],
      });
      const request = await createRequest(g, 'CANCEL', 'ESCALATED');

      await service.cancelOrderWithRefund(SELLER, g.orders[0].id);

      const saved = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(saved.status).toBe('APPROVED');
      expect(await orderStatusOf(g.orders[0].id)).toBe('CANCELLED');
    });

    it('duyệt ĐÚNG một yêu cầu mà người mua vừa rút ⇒ 409 và ROLLBACK THẬT: đơn vẫn CONFIRMED, kho không đổi, không có khoản hoàn', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'CONFIRMED', stock: 8 }],
      });
      const request = await createRequest(g, 'CANCEL', 'WITHDRAWN');

      await expectAppException(
        service.cancelOrderWithRefund(SELLER, g.orders[0].id, {
          refundRequestId: request.id,
        }),
        { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
      );

      expect(await orderStatusOf(g.orders[0].id)).toBe('CONFIRMED');
      expect(await stockOf(g.orders[0].variantId)).toBe(8);
      expect(await refundsOf(g.paymentId)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(0);
    });

    it('duyệt yêu cầu TRẢ HÀNG ESCALATED bởi Admin ⇒ đơn REFUNDED, yêu cầu APPROVED (actor ADMIN)', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'COMPLETED' }],
      });
      const request = await createRequest(g, 'RETURN', 'ESCALATED');

      await service.refundReturnedOrder(ADMIN, g.orders[0].id, {
        refundRequestId: request.id,
        reason: 'Đã xác minh',
      });

      const saved = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { history: true },
      });
      expect(saved.status).toBe('APPROVED');
      expect(saved.history[0]).toMatchObject({
        actorType: 'ADMIN',
        note: 'Đã xác minh',
      });
    });
  });

  describe('refundPayment — thanh toán bất thường (chỉ chuyển tiền)', () => {
    it('PAID_AFTER_EXPIRY: mọi đơn đã CANCELLED ⇒ hoàn toàn bộ amount (orderId null), không đụng kho/đơn; gọi lần 2 ⇒ 409', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'CANCELLED', stock: 8 }],
      });
      expect(
        (await paymentService.getCheckoutGroup(g.userId, g.groupId)).status,
      ).toBe('PAID_AFTER_EXPIRY');

      const refund = await service.refundPayment(
        ADMIN,
        g.paymentId,
        'Đến muộn',
      );

      expect(refund.status).toBe('SUCCEEDED');
      const [row] = await refundsOf(g.paymentId);
      expect(row).toMatchObject({
        orderId: null,
        initiatedByType: 'ADMIN',
        reason: 'Đến muộn',
      });
      expect((await paymentOf(g.paymentId)).status).toBe('REFUNDED');
      expect(await stockOf(g.orders[0].variantId)).toBe(8);
      expect(await orderStatusOf(g.orders[0].id)).toBe('CANCELLED');
      expect(fakeMail.sent).toHaveLength(0);

      await expectAppException(service.refundPayment(ADMIN, g.paymentId), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
    });

    it('thanh toán BÌNH THƯỜNG (đơn còn sống) ⇒ 409 PAYMENT_NOT_REFUNDABLE, không tạo gì', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING' }],
      });

      await expectAppException(service.refundPayment(ADMIN, g.paymentId), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
      expect(await refundsOf(g.paymentId)).toHaveLength(0);
    });

    it('thanh toán TRÙNG: hoàn khoản SUCCESS thứ hai, đơn vẫn sống và khoản đầu không bị đụng', async () => {
      const g = await setupGroup({
        method: 'VNPAY',
        orders: [{ status: 'PENDING', stock: 8 }],
      });
      const duplicate = await prisma.payment.create({
        data: {
          checkoutGroupId: g.groupId,
          method: 'VNPAY',
          status: 'SUCCESS',
          amount: g.amount,
          txnRef:
            `${TAG.toUpperCase()}DUP${Date.now().toString(36)}`.toUpperCase(),
          transactionId: 'GW-TXN-2',
          paidAt: new Date(),
          expiresAt: null,
        },
        select: { id: true },
      });

      // Khoản SUCCESS sớm nhất là khoản "chính": không phải bất thường.
      await expectAppException(service.refundPayment(ADMIN, g.paymentId), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
      const refund = await service.refundPayment(ADMIN, duplicate.id);

      expect(refund.status).toBe('SUCCEEDED');
      expect((await paymentOf(duplicate.id)).status).toBe('REFUNDED');
      expect((await paymentOf(g.paymentId)).status).toBe('SUCCESS');
      expect(await orderStatusOf(g.orders[0].id)).toBe('PENDING');
      expect(await stockOf(g.orders[0].variantId)).toBe(8);
    });
  });
});
