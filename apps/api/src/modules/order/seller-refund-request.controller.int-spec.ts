import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type RefundRequestKind,
  type RefundRequestStatus,
  type ShopStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  orderDetailSchema,
  sellerOrderDetailSchema,
  sellerOrderListResponseSchema,
  sellerRefundRequestListItemSchema,
  sellerRefundRequestListResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createVariant,
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật + cổng thanh toán mock) cho các route yêu cầu
// hủy/trả hàng phía SELLER (Week9.md 2.7): hàng chờ, duyệt, từ chối, tự hủy đơn đã xác nhận, và việc yêu cầu hủy
// đang chờ chặn đóng gói/giao. Chứng minh điều unit test với mock không chứng minh được: duyệt = hủy đơn + hoàn kho +
// hoàn tiền + đóng yêu cầu trong MỘT transaction (rollback thật khi người mua vừa rút), quyền theo shop, và các race
// (duyệt vs rút, đóng gói vs gửi yêu cầu) luôn kết thúc ở trạng thái nhất quán. Chạy: `pnpm test:int`.
const TAG = 'it-seller-refund-';
const STOCK = 10;
const QTY = 2;
const HOUR_MS = 60 * 60 * 1000;

interface SeedOrder {
  shopId: string;
  status: OrderStatus;
  method?: PaymentMethod;
  // Lúc đơn chuyển sang `status` (mốc COMPLETED cho cửa sổ trả hàng).
  statusAt?: Date;
}

const fakeMail = createFakeMail();

describe('Yêu cầu hủy/trả hàng phía seller (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;
  const originalMock = process.env.PAYMENT_MOCK_ENABLED;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let sellerA: Agent;
  let sellerB: Agent;
  let buyer: Agent;
  let anonymous: Agent;
  let buyerId: string;
  let shopA: string;
  let shopB: string;
  let shopSuspended: string;
  let sellerSuspended: Agent;

  async function registerAndLogin(suffix: string) {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`;
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', name: `${TAG}${suffix}` })
      .expect(201);
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: user.id };
  }

  async function createShopFor(
    ownerId: string,
    suffix: string,
    status: ShopStatus = 'APPROVED',
  ) {
    const shop = await prisma.shop.create({
      data: {
        ownerId,
        name: `${TAG}shop-${suffix}`,
        slug: `${TAG}shop-${suffix}-${stamp}`,
        status,
      },
      select: { id: true },
    });
    return shop.id;
  }

  // Đơn của `buyerId` thuộc shop của seller; kho đã chốt (đơn PENDING trở đi), Payment online SUCCESS hoặc COD.
  async function seedOrder(input: SeedOrder) {
    const method = input.method ?? 'VNPAY';
    const isCod = method === 'COD';
    const group = await createCheckoutGroup(prisma, buyerId);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: STOCK });
    const history = seedOrderHistory(input.status, { isCod });
    const order = await prisma.order.create({
      data: {
        userId: buyerId,
        shopId: input.shopId,
        checkoutGroupId: group.id,
        status: input.status,
        totalAmount: 220_000,
        shippingFee: 20_000,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: variant.id,
              quantity: QTY,
              priceAtPurchase: 100_000,
              productName: `${TAG}sp`,
              sku: `SKU-${stamp}-${++seq}`,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: {
          create: history.map((row, index) => ({
            ...row,
            actorId: row.actorType === 'BUYER' ? buyerId : undefined,
            createdAt:
              index === history.length - 1 && input.statusAt
                ? input.statusAt
                : row.createdAt,
          })),
        },
      },
      select: { id: true },
    });
    const payment = await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status: isCod
          ? input.status === 'COMPLETED' || input.status === 'REFUNDED'
            ? 'SUCCESS'
            : 'PENDING'
          : 'SUCCESS',
        amount: 220_000,
        txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
        transactionId: isCod ? null : 'GW-TXN',
        expiresAt: null,
        paidAt: isCod ? null : new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });
    return {
      orderId: order.id,
      variantId: variant.id,
      groupId: group.id,
      paymentId: payment.id,
    };
  }

  // Yêu cầu dựng thẳng bằng Prisma (trạng thái bất kỳ), kèm dòng thời gian khớp trạng thái.
  async function seedRequest(
    orderId: string,
    shopId: string,
    options: {
      kind?: RefundRequestKind;
      status: RefundRequestStatus;
      createdAt?: Date;
    },
  ) {
    const createdAt = options.createdAt ?? new Date(Date.now() - 2 * HOUR_MS);
    const kind = options.kind ?? 'CANCEL';
    const created = await prisma.refundRequest.create({
      data: {
        orderId,
        shopId,
        userId: buyerId,
        kind,
        status: options.status,
        reasonCode: kind === 'CANCEL' ? 'CHANGE_OF_MIND' : 'DAMAGED',
        reasonNote: 'Ghi chú của người mua',
        sellerRespondBy: new Date(createdAt.getTime() + 48 * HOUR_MS),
        statusChangedAt: createdAt,
        createdAt,
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: 'PENDING_SELLER',
              actorType: 'BUYER',
              actorId: buyerId,
              createdAt,
            },
          ],
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const details = (res: { body: unknown }) =>
    (res.body as { details?: unknown }).details;
  const message = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  const queueUrl = (shopId: string, query = '') =>
    `/api/v1/shops/${shopId}/refund-requests${query}`;
  const requestAction = (
    shopId: string,
    requestId: string,
    action: 'approve' | 'reject',
  ) => `/api/v1/shops/${shopId}/refund-requests/${requestId}/${action}`;
  const orderAction = (shopId: string, orderId: string, action: string) =>
    `/api/v1/shops/${shopId}/orders/${orderId}/${action}`;
  const buyerCreate = (orderId: string) =>
    `/api/v1/orders/${orderId}/refund-requests`;

  const statusOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
  const stockOf = async (variantId: string) =>
    (
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      })
    ).stock;
  const requestsOf = (orderId: string) =>
    prisma.refundRequest.findMany({
      where: { orderId },
      include: { history: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  const paymentOf = (paymentId: string) =>
    prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const refundsOf = (paymentId: string) =>
    prisma.paymentRefund.findMany({ where: { paymentId } });

  beforeAll(async () => {
    // Cổng thanh toán GIẢ: hoàn tiền tức thì, không gọi VNPay thật.
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    await cleanupByTag(prisma, TAG);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const a = await registerAndLogin('a');
    const b = await registerAndLogin('b');
    const s = await registerAndLogin('s');
    const u = await registerAndLogin('buyer');
    sellerA = a.agent;
    sellerB = b.agent;
    sellerSuspended = s.agent;
    buyer = u.agent;
    buyerId = u.userId;
    anonymous = newAgent();
    shopA = await createShopFor(a.userId, 'a');
    shopB = await createShopFor(b.userId, 'b');
    shopSuspended = await createShopFor(s.userId, 's', 'SUSPENDED');
  });

  afterEach(() => {
    fakeMail.reset();
  });

  afterAll(async () => {
    if (originalMock === undefined) delete process.env.PAYMENT_MOCK_ENABLED;
    else process.env.PAYMENT_MOCK_ENABLED = originalMock;
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /shops/:shopId/refund-requests — hàng chờ', () => {
    it('chỉ yêu cầu của shop mình, không có yêu cầu đã rút, parse được bằng schema dùng chung; đơn lạ shop không lộ', async () => {
      const mine = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const mineReq = await seedRequest(mine.orderId, shopA, {
        status: 'PENDING_SELLER',
      });
      const withdrawn = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const withdrawnReq = await seedRequest(withdrawn.orderId, shopA, {
        status: 'WITHDRAWN',
      });
      const other = await seedOrder({ shopId: shopB, status: 'CONFIRMED' });
      const otherReq = await seedRequest(other.orderId, shopB, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA.get(queueUrl(shopA, '?limit=50'));

      expect(res.status).toBe(200);
      const ids = sellerRefundRequestListResponseSchema
        .parse(data(res))
        .items.map((item) => item.id);
      expect(ids).toContain(mineReq);
      expect(ids).not.toContain(withdrawnReq);
      expect(ids).not.toContain(otherReq);
    });

    it('mỗi dòng mang lý do của người mua, tóm tắt đơn và cờ duyệt/từ chối; timeline không lộ định danh', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA.get(queueUrl(shopA, '?limit=50'));

      const item = sellerRefundRequestListResponseSchema
        .parse(data(res))
        .items.find((row) => row.id === requestId)!;
      expect(item).toMatchObject({
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Ghi chú của người mua',
        canApprove: true,
        canReject: true,
        order: {
          id: order.orderId,
          status: 'CONFIRMED',
          totalAmount: '220000',
          recipientName: 'Nguyễn Văn A',
          paymentMethod: 'VNPAY',
          paymentStatus: 'SUCCESS',
        },
      });
      for (const entry of item.history) {
        expect(entry).not.toHaveProperty('actorId');
      }
      expect(JSON.stringify(res.body)).not.toContain(buyerId);
    });

    it('lọc theo status; PENDING_SELLER xếp cũ nhất trước (hạn sớm nhất lên đầu), phân trang đúng', async () => {
      // Dùng shop riêng để đếm chính xác.
      const owner = await registerAndLogin(`queue${seq++}`);
      const shop = await createShopFor(owner.userId, `queue-${seq}`);
      const oldest = await seedOrder({ shopId: shop, status: 'CONFIRMED' });
      const middle = await seedOrder({ shopId: shop, status: 'CONFIRMED' });
      const newest = await seedOrder({ shopId: shop, status: 'PACKED' });
      const done = await seedOrder({ shopId: shop, status: 'CONFIRMED' });
      const now = Date.now();
      const r1 = await seedRequest(oldest.orderId, shop, {
        status: 'PENDING_SELLER',
        createdAt: new Date(now - 5 * HOUR_MS),
      });
      const r2 = await seedRequest(middle.orderId, shop, {
        status: 'PENDING_SELLER',
        createdAt: new Date(now - 3 * HOUR_MS),
      });
      const r3 = await seedRequest(newest.orderId, shop, {
        status: 'PENDING_SELLER',
        createdAt: new Date(now - 1 * HOUR_MS),
      });
      const r4 = await seedRequest(done.orderId, shop, {
        status: 'REJECTED_BY_SELLER',
        createdAt: new Date(now - 4 * HOUR_MS),
      });

      const pending = sellerRefundRequestListResponseSchema.parse(
        data(await owner.agent.get(queueUrl(shop, '?status=PENDING_SELLER'))),
      );
      const all = sellerRefundRequestListResponseSchema.parse(
        data(await owner.agent.get(queueUrl(shop))),
      );
      const page2 = sellerRefundRequestListResponseSchema.parse(
        data(await owner.agent.get(queueUrl(shop, '?page=2&limit=3'))),
      );

      expect(pending.items.map((i) => i.id)).toEqual([r1, r2, r3]);
      expect(pending.total).toBe(3);
      // Không lọc: mới nhất trước.
      expect(all.items.map((i) => i.id)).toEqual([r3, r2, r4, r1]);
      expect(all.total).toBe(4);
      expect(page2).toMatchObject({ total: 4, page: 2, limit: 3 });
      expect(page2.items.map((i) => i.id)).toEqual([r1]);
    });

    it('yêu cầu của đơn Seller không được thấy (đơn chưa từng được thanh toán) không lộ trong hàng chờ', async () => {
      const hidden = await seedOrder({ shopId: shopA, status: 'CANCELLED' });
      // Đơn online CANCELLED chưa từng PENDING: history chỉ AWAITING_PAYMENT → CANCELLED.
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: hidden.orderId, toStatus: 'PENDING' },
      });
      const hiddenReq = await seedRequest(hidden.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA.get(queueUrl(shopA, '?limit=50'));

      expect(
        sellerRefundRequestListResponseSchema
          .parse(data(res))
          .items.map((i) => i.id),
      ).not.toContain(hiddenReq);
    });

    it('status WITHDRAWN hoặc lạ ⇒ 400; limit > 50 ⇒ 400', async () => {
      const r1 = await sellerA.get(queueUrl(shopA, '?status=WITHDRAWN'));
      const r2 = await sellerA.get(queueUrl(shopA, '?status=WEIRD'));
      const r3 = await sellerA.get(queueUrl(shopA, '?limit=51'));

      expect(r1.status).toBe(400);
      expect(r2.status).toBe(400);
      expect(r3.status).toBe(400);
    });

    it('seller khác ⇒ 403; chưa đăng nhập ⇒ 401; shop không tồn tại ⇒ 404', async () => {
      expect((await sellerB.get(queueUrl(shopA))).status).toBe(403);
      expect((await anonymous.get(queueUrl(shopA))).status).toBe(401);
      expect(
        (await sellerA.get(queueUrl('00000000-0000-4000-8000-000000000000')))
          .status,
      ).toBe(404);
    });
  });

  describe('chi tiết / danh sách đơn của seller mang yêu cầu', () => {
    it('danh sách đơn có tóm tắt (không lý do), chi tiết đơn có yêu cầu đầy đủ + cờ; đơn không có yêu cầu thì null', async () => {
      const withReq = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const reqId = await seedRequest(withReq.orderId, shopA, {
        status: 'PENDING_SELLER',
      });
      const plain = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });

      const list = sellerOrderListResponseSchema.parse(
        data(await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`)),
      );
      const detail = sellerOrderDetailSchema.parse(
        data(
          await sellerA.get(`/api/v1/shops/${shopA}/orders/${withReq.orderId}`),
        ),
      );

      const listed = list.items.find((o) => o.id === withReq.orderId)!;
      expect(listed.refundRequest).toEqual({
        id: reqId,
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        sellerRespondBy: expect.any(String) as string,
      });
      expect(listed.canPack).toBe(false);
      expect(
        list.items.find((o) => o.id === plain.orderId)!.refundRequest,
      ).toBeNull();
      expect(detail.refundRequest).toMatchObject({
        id: reqId,
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Ghi chú của người mua',
        canApprove: true,
        canReject: true,
      });
    });
  });

  describe('POST .../refund-requests/:id/approve — duyệt', () => {
    it('luồng đầy đủ yêu cầu HỦY đơn ĐÃ TRẢ ONLINE: buyer gửi → seller duyệt ⇒ đơn CANCELLED, kho +qty, hoàn tiền SUCCEEDED, Payment REFUNDED, yêu cầu APPROVED, buyer thấy ghi chú, email "theo yêu cầu của bạn" kèm hoàn tiền', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const created = await buyer
        .post(buyerCreate(order.orderId))
        .send({ reasonCode: 'CHANGE_OF_MIND' });
      expect(created.status).toBe(201);
      const requestId = orderDetailSchema.parse(data(created)).refundRequest!
        .id;
      fakeMail.reset();

      const res = await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .send({ note: 'Đồng ý hủy' });

      expect(res.status).toBe(200);
      expect(sellerRefundRequestListItemSchema.parse(data(res))).toMatchObject({
        id: requestId,
        status: 'APPROVED',
        canApprove: false,
        canReject: false,
        order: { id: order.orderId, status: 'CANCELLED' },
      });
      expect(await statusOf(order.orderId)).toBe('CANCELLED');
      expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(220_000);
      const [refund] = await refundsOf(order.paymentId);
      expect(refund).toMatchObject({
        orderId: order.orderId,
        refundRequestId: requestId,
        status: 'SUCCEEDED',
        initiatedByType: 'SELLER',
      });

      const [row] = await requestsOf(order.orderId);
      expect(row.status).toBe('APPROVED');
      expect(row.history.map((h) => h.toStatus)).toEqual([
        'PENDING_SELLER',
        'APPROVED',
      ]);
      expect(row.history[1]).toMatchObject({
        actorType: 'SELLER',
        note: 'Đồng ý hủy',
      });

      const buyerView = orderDetailSchema.parse(
        data(await buyer.get(`/api/v1/orders/${order.orderId}`)),
      );
      expect(buyerView).toMatchObject({
        status: 'CANCELLED',
        refund: { status: 'SUCCEEDED', amount: '220000' },
        refundRequest: { status: 'APPROVED', canWithdraw: false },
      });
      expect(buyerView.refundRequest?.history[1]).toMatchObject({
        note: 'Đồng ý hủy',
      });
      expect(JSON.stringify(buyerView)).not.toContain('actorId');

      expect(fakeMail.sent).toHaveLength(1);
      expect(fakeMail.sent[0].subject).toBe('Bạn đã hủy đơn hàng');
      expect(fakeMail.sent[0].html).toContain('theo yêu cầu của bạn');
      expect(fakeMail.sent[0].html).toContain('đang hoàn');
    });

    it('yêu cầu HỦY đơn COD: đơn CANCELLED, kho +qty, KHÔNG có khoản hoàn qua cổng, Payment COD → CANCELLED', async () => {
      const order = await seedOrder({
        shopId: shopA,
        status: 'PACKED',
        method: 'COD',
      });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .send({});

      expect(res.status).toBe(200);
      expect(await statusOf(order.orderId)).toBe('CANCELLED');
      expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
      expect(await refundsOf(order.paymentId)).toHaveLength(0);
      expect((await paymentOf(order.paymentId)).status).toBe('CANCELLED');
      // Duyệt không ghi chú ⇒ note null (không chuỗi mặc định).
      const [row] = await requestsOf(order.orderId);
      expect(row.history[1].note).toBeNull();
    });

    it('không gửi body vẫn duyệt được (ghi chú tuỳ chọn)', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA.post(
        requestAction(shopA, requestId, 'approve'),
      );

      expect(res.status).toBe(200);
    });

    it('yêu cầu TRẢ HÀNG đơn online: COMPLETED → REFUNDED, hoàn tiền, KHÔNG cộng kho, KHÔNG email "đơn bị hủy"', async () => {
      const order = await seedOrder({
        shopId: shopA,
        status: 'COMPLETED',
        statusAt: new Date(Date.now() - 1 * 24 * HOUR_MS),
      });
      const requestId = await seedRequest(order.orderId, shopA, {
        kind: 'RETURN',
        status: 'PENDING_SELLER',
      });

      const res = await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .send({ note: 'Đã nhận hàng trả về' });

      expect(res.status).toBe(200);
      expect(await statusOf(order.orderId)).toBe('REFUNDED');
      expect(await stockOf(order.variantId)).toBe(STOCK);
      expect((await paymentOf(order.paymentId)).status).toBe('REFUNDED');
      expect(fakeMail.sent).toHaveLength(0);
    });

    it('yêu cầu TRẢ HÀNG đơn COD: REFUNDED, không có khoản hoàn qua cổng, Payment COD giữ SUCCESS', async () => {
      const order = await seedOrder({
        shopId: shopA,
        status: 'COMPLETED',
        method: 'COD',
        statusAt: new Date(Date.now() - 1 * 24 * HOUR_MS),
      });
      const requestId = await seedRequest(order.orderId, shopA, {
        kind: 'RETURN',
        status: 'PENDING_SELLER',
      });

      await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .expect(200);

      expect(await statusOf(order.orderId)).toBe('REFUNDED');
      expect(await refundsOf(order.paymentId)).toHaveLength(0);
      expect((await paymentOf(order.paymentId)).status).toBe('SUCCESS');
    });

    it('yêu cầu HỦY đã lên sàn (ESCALATED) vẫn duyệt được — seller nhượng bộ; yêu cầu TRẢ HÀNG đã lên sàn ⇒ 409, đơn không đổi', async () => {
      const cancelOrder = await seedOrder({
        shopId: shopA,
        status: 'CONFIRMED',
      });
      const cancelReq = await seedRequest(cancelOrder.orderId, shopA, {
        status: 'ESCALATED',
      });
      const returnOrder = await seedOrder({
        shopId: shopA,
        status: 'COMPLETED',
        statusAt: new Date(),
      });
      const returnReq = await seedRequest(returnOrder.orderId, shopA, {
        kind: 'RETURN',
        status: 'ESCALATED',
      });

      const ok = await sellerA.post(requestAction(shopA, cancelReq, 'approve'));
      const refused = await sellerA.post(
        requestAction(shopA, returnReq, 'approve'),
      );

      expect(ok.status).toBe(200);
      expect(await statusOf(cancelOrder.orderId)).toBe('CANCELLED');
      expect(refused.status).toBe(409);
      expect(code(refused)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
      expect(await statusOf(returnOrder.orderId)).toBe('COMPLETED');
    });

    it('duyệt 2 lần ⇒ lần 2 là 409 và KHÔNG hoàn tiền/cộng kho thêm', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });
      await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .expect(200);

      const again = await sellerA.post(
        requestAction(shopA, requestId, 'approve'),
      );

      expect(again.status).toBe(409);
      expect(code(again)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
      expect(await refundsOf(order.paymentId)).toHaveLength(1);
      expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
    });

    it('ghi chú quá 500 ký tự ⇒ 400, không đổi gì', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA
        .post(requestAction(shopA, requestId, 'approve'))
        .send({ note: 'x'.repeat(501) });

      expect(res.status).toBe(400);
      expect(message(res)).toContain('order.validationReasonTooLong');
      expect(await statusOf(order.orderId)).toBe('CONFIRMED');
    });

    it('yêu cầu của shop khác / đã rút / không tồn tại ⇒ 404; seller khác chủ shop ⇒ 403; chưa đăng nhập ⇒ 401 — không đổi gì', async () => {
      const mine = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const mineReq = await seedRequest(mine.orderId, shopA, {
        status: 'PENDING_SELLER',
      });
      const withdrawn = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const withdrawnReq = await seedRequest(withdrawn.orderId, shopA, {
        status: 'WITHDRAWN',
      });

      // seller B đi vòng qua shop CỦA MÌNH với id yêu cầu của shop A.
      const crossShop = await sellerB.post(
        requestAction(shopB, mineReq, 'approve'),
      );
      const notOwner = await sellerB.post(
        requestAction(shopA, mineReq, 'approve'),
      );
      const noAuth = await anonymous.post(
        requestAction(shopA, mineReq, 'approve'),
      );
      const gone = await sellerA.post(
        requestAction(shopA, withdrawnReq, 'approve'),
      );
      const missing = await sellerA.post(
        requestAction(shopA, '00000000-0000-4000-8000-000000000000', 'approve'),
      );

      expect(crossShop.status).toBe(404);
      expect(code(crossShop)).toBe('REFUND_REQUEST_NOT_FOUND');
      expect(notOwner.status).toBe(403);
      expect(noAuth.status).toBe(401);
      expect(gone.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await statusOf(mine.orderId)).toBe('CONFIRMED');
      expect(await statusOf(withdrawn.orderId)).toBe('CONFIRMED');
    });

    it('shop bị khoá tạm (SUSPENDED) vẫn duyệt được yêu cầu của đơn đã có', async () => {
      const order = await seedOrder({
        shopId: shopSuspended,
        status: 'CONFIRMED',
      });
      const requestId = await seedRequest(order.orderId, shopSuspended, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerSuspended.post(
        requestAction(shopSuspended, requestId, 'approve'),
      );

      expect(res.status).toBe(200);
      expect(await statusOf(order.orderId)).toBe('CANCELLED');
    });

    it('RACE: seller DUYỆT vs người mua RÚT cùng yêu cầu (8 vòng) — đúng 1 bên thắng; duyệt thắng ⇒ đơn hủy + hoàn tiền 1 lần, rút thắng ⇒ đơn VẪN CONFIRMED (không hủy oan), kho/tiền nhất quán', async () => {
      for (let round = 0; round < 8; round++) {
        const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
        const requestId = await seedRequest(order.orderId, shopA, {
          status: 'PENDING_SELLER',
        });

        const [approve, withdraw] = await Promise.all([
          sellerA.post(requestAction(shopA, requestId, 'approve')),
          buyer.post(`/api/v1/refund-requests/${requestId}/withdraw`),
        ]);

        expect(
          [approve.status === 200, withdraw.status === 200].sort(),
        ).toEqual([false, true]);
        const [row] = await requestsOf(order.orderId);
        if (approve.status === 200) {
          expect(row.status).toBe('APPROVED');
          expect(await statusOf(order.orderId)).toBe('CANCELLED');
          expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
          expect(await refundsOf(order.paymentId)).toHaveLength(1);
        } else {
          expect(row.status).toBe('WITHDRAWN');
          expect(await statusOf(order.orderId)).toBe('CONFIRMED');
          expect(await stockOf(order.variantId)).toBe(STOCK);
          expect(await refundsOf(order.paymentId)).toHaveLength(0);
        }
        // Mỗi yêu cầu có đúng 1 dòng chuyển (sau mốc tạo).
        expect(row.history).toHaveLength(2);
      }
    });
  });

  describe('POST .../refund-requests/:id/reject — từ chối', () => {
    it('chờ seller ⇒ 200, REJECTED_BY_SELLER, đơn GIỮ NGUYÊN; buyer đọc được lý do và khiếu nại được; seller thấy hết cờ', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const created = await buyer
        .post(buyerCreate(order.orderId))
        .send({ reasonCode: 'CHANGE_OF_MIND' });
      const requestId = orderDetailSchema.parse(data(created)).refundRequest!
        .id;

      const res = await sellerA
        .post(requestAction(shopA, requestId, 'reject'))
        .send({ note: 'Hàng đã đóng gói' });

      expect(res.status).toBe(200);
      expect(sellerRefundRequestListItemSchema.parse(data(res))).toMatchObject({
        status: 'REJECTED_BY_SELLER',
        canApprove: false,
        canReject: false,
      });
      expect(await statusOf(order.orderId)).toBe('CONFIRMED');
      expect(await stockOf(order.variantId)).toBe(STOCK);
      expect(await refundsOf(order.paymentId)).toHaveLength(0);

      const buyerView = orderDetailSchema.parse(
        data(await buyer.get(`/api/v1/orders/${order.orderId}`)),
      );
      expect(buyerView.refundRequest).toMatchObject({
        status: 'REJECTED_BY_SELLER',
        canEscalate: true,
        canWithdraw: false,
      });
      expect(buyerView.refundRequest?.history.at(-1)).toMatchObject({
        toStatus: 'REJECTED_BY_SELLER',
        actorType: 'SELLER',
        note: 'Hàng đã đóng gói',
      });
      await buyer
        .post(`/api/v1/refund-requests/${requestId}/escalate`)
        .expect(200);
    });

    it('thiếu ghi chú (hoặc không gửi body) ⇒ 400 theo field note; ghi chú rỗng ⇒ 400; không đổi gì', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const noBody = await sellerA.post(
        requestAction(shopA, requestId, 'reject'),
      );
      const blank = await sellerA
        .post(requestAction(shopA, requestId, 'reject'))
        .send({ note: '   ' });

      expect(noBody.status).toBe(400);
      expect(message(noBody)).toBe('note: order.validationReasonRequired');
      expect(blank.status).toBe(400);
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'PENDING_SELLER',
      );
    });

    it.each(['ESCALATED', 'REJECTED_BY_SELLER', 'APPROVED'] as const)(
      'yêu cầu đã %s ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION, trạng thái không đổi',
      async (status) => {
        const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
        const requestId = await seedRequest(order.orderId, shopA, { status });

        const res = await sellerA
          .post(requestAction(shopA, requestId, 'reject'))
          .send({ note: 'x' });

        expect(res.status).toBe(409);
        expect(code(res)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
        expect((await requestsOf(order.orderId))[0].status).toBe(status);
      },
    );

    it('yêu cầu của shop khác ⇒ 404 (đi vòng qua shop mình), seller khác chủ shop ⇒ 403', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const cross = await sellerB
        .post(requestAction(shopB, requestId, 'reject'))
        .send({ note: 'x' });
      const notOwner = await sellerB
        .post(requestAction(shopA, requestId, 'reject'))
        .send({ note: 'x' });

      expect(cross.status).toBe(404);
      expect(notOwner.status).toBe(403);
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'PENDING_SELLER',
      );
    });
  });

  describe('yêu cầu hủy đang chờ chặn đóng gói / giao hàng', () => {
    it('buyer gửi yêu cầu hủy ⇒ seller đóng gói bị 409 REFUND_REQUEST_PENDING và đơn VẪN CONFIRMED; từ chối yêu cầu xong thì đóng gói được', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const created = await buyer
        .post(buyerCreate(order.orderId))
        .send({ reasonCode: 'CHANGE_OF_MIND' });
      const requestId = orderDetailSchema.parse(data(created)).refundRequest!
        .id;

      const blocked = await sellerA.post(
        orderAction(shopA, order.orderId, 'pack'),
      );

      expect(blocked.status).toBe(409);
      expect(code(blocked)).toBe('REFUND_REQUEST_PENDING');
      expect(await statusOf(order.orderId)).toBe('CONFIRMED');
      // Không để lại dòng lịch sử đóng gói (rollback thật).
      expect(
        await prisma.orderStatusHistory.count({
          where: { orderId: order.orderId, toStatus: 'PACKED' },
        }),
      ).toBe(0);

      await sellerA
        .post(requestAction(shopA, requestId, 'reject'))
        .send({ note: 'Đã đóng gói' })
        .expect(200);
      await sellerA.post(orderAction(shopA, order.orderId, 'pack')).expect(200);
      expect(await statusOf(order.orderId)).toBe('PACKED');
    });

    it('giao hàng cũng bị chặn khi đơn PACKED có yêu cầu hủy chờ (kể cả đã lên sàn), không ghi vận chuyển; người mua rút thì giao được', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'PACKED' });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'ESCALATED',
      });

      const blocked = await sellerA
        .post(orderAction(shopA, order.orderId, 'ship'))
        .send({ carrier: 'GHN' });

      expect(blocked.status).toBe(409);
      expect(code(blocked)).toBe('REFUND_REQUEST_PENDING');
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } }))
          .carrier,
      ).toBeNull();

      await prisma.refundRequest.update({
        where: { id: requestId },
        data: { status: 'WITHDRAWN' },
      });
      await sellerA
        .post(orderAction(shopA, order.orderId, 'ship'))
        .send({ carrier: 'GHN' })
        .expect(200);
      expect(await statusOf(order.orderId)).toBe('SHIPPING');
    });

    it('RACE: seller ĐÓNG GÓI vs buyer GỬI YÊU CẦU HỦY (8 vòng) — không bao giờ ra "đã đóng gói mà còn yêu cầu hủy mở"; hai thứ tự đều nhất quán', async () => {
      let packedFirst = 0;
      let requestFirst = 0;
      for (let round = 0; round < 8; round++) {
        const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });

        const [pack, create] = await Promise.all([
          sellerA.post(orderAction(shopA, order.orderId, 'pack')),
          buyer
            .post(buyerCreate(order.orderId))
            .send({ reasonCode: 'CHANGE_OF_MIND' }),
        ]);

        const requests = await requestsOf(order.orderId);
        const final = await statusOf(order.orderId);
        if (pack.status === 200) {
          // Đóng gói thắng: đơn PACKED. Buyer hoặc thua race (409), hoặc gửi được yêu cầu cho đơn PACKED
          // (hợp lệ: PACKED vẫn xin hủy được) — nhưng KHÔNG được có yêu cầu mở của CONFIRMED trước đó.
          packedFirst += 1;
          expect(final).toBe('PACKED');
          if (create.status === 409) {
            expect(code(create)).toBe('ORDER_ALREADY_CHANGED');
            expect(requests).toHaveLength(0);
          } else {
            expect(create.status).toBe(201);
            expect(requests).toHaveLength(1);
          }
        } else {
          // Yêu cầu thắng: đóng gói bị chặn, đơn còn CONFIRMED với đúng 1 yêu cầu chờ.
          requestFirst += 1;
          expect(create.status).toBe(201);
          expect(pack.status).toBe(409);
          expect(code(pack)).toBe('REFUND_REQUEST_PENDING');
          expect(final).toBe('CONFIRMED');
          expect(requests).toHaveLength(1);
          expect(requests[0].status).toBe('PENDING_SELLER');
        }
      }
      expect(packedFirst + requestFirst).toBe(8);
    });
  });

  describe('POST .../orders/:orderId/cancel — seller tự hủy đơn đã xác nhận', () => {
    it('đơn CONFIRMED đã trả online: 200, CANCELLED, kho +qty, hoàn tiền SUCCEEDED, Payment REFUNDED, lý do trong timeline, email "bị shop từ chối" kèm hoàn tiền', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });

      const res = await sellerA
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: 'Hết hàng, xin lỗi bạn' });

      expect(res.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(data(res))).toMatchObject({
        status: 'CANCELLED',
        canCancel: false,
        canPack: false,
        refundRequest: null,
      });
      expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
      expect((await paymentOf(order.paymentId)).status).toBe('REFUNDED');
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.orderId, toStatus: 'CANCELLED' },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        actorType: 'SELLER',
        note: 'Hết hàng, xin lỗi bạn',
      });
      expect(fakeMail.sent.map((m) => m.subject)).toEqual([
        'Đơn hàng của bạn đã bị shop từ chối',
      ]);
      expect(fakeMail.sent[0].html).toContain('đang hoàn');
    });

    it('đơn PACKED COD có yêu cầu hủy đang chờ ⇒ hủy được (không bị chặn) và TỰ ĐÓNG yêu cầu thành APPROVED (actor SELLER, ghi chú = lý do hủy)', async () => {
      const order = await seedOrder({
        shopId: shopA,
        status: 'PACKED',
        method: 'COD',
      });
      const requestId = await seedRequest(order.orderId, shopA, {
        status: 'PENDING_SELLER',
      });

      const res = await sellerA
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: 'Hết hàng' });

      expect(res.status).toBe(200);
      const [row] = await requestsOf(order.orderId);
      expect(row.id).toBe(requestId);
      expect(row.status).toBe('APPROVED');
      expect(row.history.at(-1)).toMatchObject({
        toStatus: 'APPROVED',
        actorType: 'SELLER',
        note: 'Hết hàng',
      });
      // Email nói "theo yêu cầu của bạn" vì người mua cũng đã xin hủy.
      expect(fakeMail.sent[0].html).toContain('theo yêu cầu của bạn');
    });

    it('yêu cầu đã lên sàn (ESCALATED) cũng được đóng khi seller tự hủy — không để treo trong hàng chờ Admin', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      await seedRequest(order.orderId, shopA, { status: 'ESCALATED' });

      await sellerA
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: 'Nhượng bộ' })
        .expect(200);

      expect((await requestsOf(order.orderId))[0].status).toBe('APPROVED');
    });

    it('thiếu lý do (hoặc không gửi body) ⇒ 400 theo field reason; đơn không đổi', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });

      const noBody = await sellerA.post(
        orderAction(shopA, order.orderId, 'cancel'),
      );
      const blank = await sellerA
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: '  ' });

      expect(noBody.status).toBe(400);
      expect(message(noBody)).toBe('reason: order.validationReasonRequired');
      expect(blank.status).toBe(400);
      expect(await statusOf(order.orderId)).toBe('CONFIRMED');
    });

    it('đơn chờ xác nhận ⇒ 409 ORDER_INVALID_TRANSITION (dùng "từ chối"); đang giao ⇒ 409 IN_TRANSIT; đã hoàn tất / đã hủy ⇒ 409 INVALID_TRANSITION', async () => {
      const pending = await seedOrder({ shopId: shopA, status: 'PENDING' });
      const shipping = await seedOrder({ shopId: shopA, status: 'SHIPPING' });
      const completed = await seedOrder({ shopId: shopA, status: 'COMPLETED' });
      const cancelled = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      await sellerA
        .post(orderAction(shopA, cancelled.orderId, 'cancel'))
        .send({ reason: 'x' })
        .expect(200);

      const r1 = await sellerA
        .post(orderAction(shopA, pending.orderId, 'cancel'))
        .send({ reason: 'x' });
      const r2 = await sellerA
        .post(orderAction(shopA, shipping.orderId, 'cancel'))
        .send({ reason: 'x' });
      const r3 = await sellerA
        .post(orderAction(shopA, completed.orderId, 'cancel'))
        .send({ reason: 'x' });
      const r4 = await sellerA
        .post(orderAction(shopA, cancelled.orderId, 'cancel'))
        .send({ reason: 'x' });

      expect(r1.status).toBe(409);
      expect(code(r1)).toBe('ORDER_INVALID_TRANSITION');
      expect(r2.status).toBe(409);
      expect(code(r2)).toBe('ORDER_CANCEL_NOT_ALLOWED');
      expect(details(r2)).toEqual({ reason: 'IN_TRANSIT' });
      expect(r3.status).toBe(409);
      expect(code(r3)).toBe('ORDER_INVALID_TRANSITION');
      expect(r4.status).toBe(409);
      expect(code(r4)).toBe('ORDER_INVALID_TRANSITION');
      expect(await statusOf(pending.orderId)).toBe('PENDING');
      expect(await stockOf(cancelled.variantId)).toBe(STOCK + QTY); // đơn đã hủy không cộng kho lần 2
    });

    it('đơn của shop khác ⇒ 404 (đi vòng qua shop mình); seller khác chủ shop ⇒ 403; đơn chưa thanh toán ⇒ 404; chưa đăng nhập ⇒ 401', async () => {
      const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const unpaid = await seedOrder({
        shopId: shopA,
        status: 'AWAITING_PAYMENT',
      });

      const cross = await sellerB
        .post(orderAction(shopB, order.orderId, 'cancel'))
        .send({ reason: 'x' });
      const notOwner = await sellerB
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: 'x' });
      const hidden = await sellerA
        .post(orderAction(shopA, unpaid.orderId, 'cancel'))
        .send({ reason: 'x' });
      const noAuth = await anonymous
        .post(orderAction(shopA, order.orderId, 'cancel'))
        .send({ reason: 'x' });

      expect(cross.status).toBe(404);
      expect(notOwner.status).toBe(403);
      expect(hidden.status).toBe(404);
      expect(noAuth.status).toBe(401);
      expect(await statusOf(order.orderId)).toBe('CONFIRMED');
    });

    it('RACE: seller tự hủy vs buyer rút yêu cầu / hủy lặp lại (6 vòng) — đơn chỉ hủy và hoàn tiền ĐÚNG 1 lần', async () => {
      for (let round = 0; round < 6; round++) {
        const order = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
        await seedRequest(order.orderId, shopA, { status: 'PENDING_SELLER' });

        const results = await Promise.all([
          sellerA
            .post(orderAction(shopA, order.orderId, 'cancel'))
            .send({ reason: 'a' }),
          sellerA
            .post(orderAction(shopA, order.orderId, 'cancel'))
            .send({ reason: 'b' }),
        ]);

        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(await refundsOf(order.paymentId)).toHaveLength(1);
        expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
        const [row] = await requestsOf(order.orderId);
        expect(row.status).toBe('APPROVED');
      }
    });
  });

  describe('reject đơn chờ xác nhận — mọi phương thức thanh toán', () => {
    it('đơn CONFIRMED ⇒ 409 PROCESSING_STARTED (dùng "hủy đơn"), đơn PENDING đã trả online ⇒ 200 kèm hoàn tiền', async () => {
      const confirmed = await seedOrder({ shopId: shopA, status: 'CONFIRMED' });
      const pending = await seedOrder({ shopId: shopA, status: 'PENDING' });

      const refused = await sellerA
        .post(orderAction(shopA, confirmed.orderId, 'reject'))
        .send({ reason: 'x' });
      const ok = await sellerA
        .post(orderAction(shopA, pending.orderId, 'reject'))
        .send({ reason: 'Hết hàng' });

      expect(refused.status).toBe(409);
      expect(details(refused)).toEqual({ reason: 'PROCESSING_STARTED' });
      expect(ok.status).toBe(200);
      expect((await paymentOf(pending.paymentId)).status).toBe('REFUNDED');
    });

    it('RACE: seller XÁC NHẬN vs buyer HỦY NGAY vs seller TỪ CHỐI cùng 1 đơn online chờ xác nhận (6 vòng) — đúng một kết cục, tiền/kho nhất quán', async () => {
      for (let round = 0; round < 6; round++) {
        const order = await seedOrder({ shopId: shopA, status: 'PENDING' });

        const [confirm, cancel, reject] = await Promise.all([
          sellerA.post(orderAction(shopA, order.orderId, 'confirm')),
          buyer.post(`/api/v1/orders/${order.orderId}/cancel`),
          sellerA
            .post(orderAction(shopA, order.orderId, 'reject'))
            .send({ reason: 'x' }),
        ]);

        const final = await statusOf(order.orderId);
        const wins = [confirm, cancel, reject].filter((r) => r.status === 200);
        expect(wins).toHaveLength(1);
        const refunds = await refundsOf(order.paymentId);
        if (final === 'CANCELLED') {
          expect(refunds).toHaveLength(1);
          expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
        } else {
          expect(final).toBe('CONFIRMED');
          expect(confirm.status).toBe(200);
          expect(refunds).toHaveLength(0);
          expect(await stockOf(order.variantId)).toBe(STOCK);
        }
      }
    });
  });
});
