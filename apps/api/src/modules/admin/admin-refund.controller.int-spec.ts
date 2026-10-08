import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type PaymentRefundStatus,
  type PaymentStatus,
  type RefundRequestKind,
  type RefundRequestStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  adminRefundListResponseSchema,
  adminRefundRequestListResponseSchema,
  adminRefundRequestSchema,
  adminRefundSchema,
  adminRefundablePaymentListResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật + cổng mock) cho khu Admin xử lý tiền hoàn
// (Week9.md 2.9): hàng chờ khiếu nại + quyết định, sổ cái hoàn tiền (thử lại / ghi nhận thủ công), thanh toán bất
// thường. Chứng minh điều unit test với mock không chứng minh được: RolesGuard thật chặn user thường / khách ở MỌI
// route, bộ lọc SQL của "thanh toán cần hoàn" khớp luật phân loại, hoàn Payment bất thường KHÔNG đụng kho/voucher/
// đơn, hai Admin quyết định cùng một yêu cầu ⇒ đúng một bên thắng, và mọi response parse được bằng đúng Zod
// schema FE sẽ dùng. Chạy: `pnpm test:int`.
const TAG = 'it-admin-refund-';
const PASSWORD = 'password123';
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const STOCK = 8;
const QTY = 2;
const TOTAL = 220_000;

const fakeMail = createFakeMail();

describe('AdminRefundController (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let secondAdmin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;

  const originalEnv = {
    mock: process.env.PAYMENT_MOCK_ENABLED,
    fail: process.env.PAYMENT_MOCK_REFUND_FAIL,
  };

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const message = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function createAdmin(suffix: string) {
    const email = `${TAG}${stamp}${suffix}@test.local`;
    await seedAdmin(prisma, { email, password: PASSWORD });
    const agent = newAgent();
    await loginAs(agent, email);
    const row = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: row.id };
  }

  // Đơn của một người mua MỚI (email tiền tố TAG, để kiểm email người mua ở response) trong nhóm riêng.
  interface SeedOrder {
    status: OrderStatus;
    method?: Extract<PaymentMethod, 'VNPAY' | 'COD'>;
    paymentStatus?: PaymentStatus;
    paidAt?: Date | null;
    // Thêm Payment SUCCESS thứ hai (khách trả hai lần) với mốc sớm/muộn hơn khoản đầu.
    extraPayment?: { paidAt: Date };
    stock?: number;
  }

  async function seedOrder(input: SeedOrder) {
    const method = input.method ?? 'VNPAY';
    const isCod = method === 'COD';
    const buyer = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, buyer.id);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, {
      stock: input.stock ?? STOCK,
    });
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: input.status,
        totalAmount: TOTAL,
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
          create: seedOrderHistory(input.status, { isCod }),
        },
      },
      select: { id: true },
    });
    const paidAt =
      input.paidAt === undefined
        ? isCod
          ? null
          : new Date(Date.now() - 2 * HOUR_MS)
        : input.paidAt;
    const payment = await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status: input.paymentStatus ?? (isCod ? 'PENDING' : 'SUCCESS'),
        amount: TOTAL,
        txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
        transactionId: isCod ? null : `GW-${stamp}-${seq}`,
        expiresAt: null,
        paidAt,
      },
      select: { id: true },
    });
    const extra = input.extraPayment
      ? await prisma.payment.create({
          data: {
            checkoutGroupId: group.id,
            method,
            status: 'SUCCESS',
            amount: TOTAL,
            txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
            transactionId: `GW-${stamp}-${seq}`,
            expiresAt: null,
            paidAt: input.extraPayment.paidAt,
          },
          select: { id: true },
        })
      : null;
    return {
      buyerId: buyer.id,
      groupId: group.id,
      orderId: order.id,
      shopId: base.shopId,
      variantId: variant.id,
      paymentId: payment.id,
      extraPaymentId: extra?.id ?? null,
    };
  }
  type Seeded = Awaited<ReturnType<typeof seedOrder>>;

  async function seedRequest(
    order: Seeded,
    options: {
      kind: RefundRequestKind;
      status: RefundRequestStatus;
      statusChangedAt?: Date;
    },
  ) {
    const changedAt = options.statusChangedAt ?? new Date();
    const createdAt = new Date(changedAt.getTime() - 3 * HOUR_MS);
    const escalated = options.status === 'ESCALATED';
    const request = await prisma.refundRequest.create({
      data: {
        orderId: order.orderId,
        shopId: order.shopId,
        userId: order.buyerId,
        kind: options.kind,
        status: options.status,
        reasonCode: options.kind === 'CANCEL' ? 'CHANGE_OF_MIND' : 'DAMAGED',
        reasonNote: 'Ghi chú của người mua',
        sellerRespondBy: new Date(createdAt.getTime() + 48 * HOUR_MS),
        statusChangedAt: changedAt,
        createdAt,
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: 'PENDING_SELLER',
              actorType: 'BUYER',
              actorId: order.buyerId,
              createdAt,
            },
            ...(options.status !== 'PENDING_SELLER'
              ? [
                  {
                    fromStatus: 'PENDING_SELLER' as const,
                    toStatus: (escalated
                      ? 'REJECTED_BY_SELLER'
                      : options.status) as RefundRequestStatus,
                    actorType: 'SELLER' as const,
                    actorId: 'seller-secret-id',
                    note: 'Hàng đã giao vận chuyển',
                    createdAt: new Date(createdAt.getTime() + HOUR_MS),
                  },
                ]
              : []),
            ...(escalated
              ? [
                  {
                    fromStatus: 'REJECTED_BY_SELLER' as const,
                    toStatus: 'ESCALATED' as const,
                    actorType: 'BUYER' as const,
                    actorId: order.buyerId,
                    createdAt: changedAt,
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });
    return request.id;
  }

  async function seedRefund(
    order: Seeded,
    options: {
      status: PaymentRefundStatus;
      ageMs?: number;
      attached?: boolean;
      amount?: number;
    },
  ) {
    const refund = await prisma.paymentRefund.create({
      data: {
        paymentId: order.paymentId,
        orderId: options.attached === false ? null : order.orderId,
        amount: options.amount ?? TOTAL,
        status: options.status,
        failureReason: options.status === 'FAILED' ? 'Gateway said no' : null,
        initiatedByType: 'ADMIN',
        attempts: 1,
        updatedAt: new Date(Date.now() - (options.ageMs ?? 10 * MIN_MS)),
      },
      select: { id: true },
    });
    return refund.id;
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
      select: { status: true, refundedAmount: true },
    });
  const refundsOf = (paymentId: string) =>
    prisma.paymentRefund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
  const requestOf = (id: string) =>
    prisma.refundRequest.findUniqueOrThrow({
      where: { id },
      include: { history: { orderBy: { createdAt: 'asc' } } },
    });

  // Dev DB có thể còn dữ liệu của lần test tay — duyệt qua các trang tới khi thấy (cùng admin shops int-spec).
  async function findInList<T extends { id: string }>(
    url: string,
    parse: (raw: unknown) => { items: T[]; total: number },
    id: string,
  ): Promise<T | undefined> {
    for (let page = 1; page <= 20; page++) {
      const res = await admin
        .get(`${url}${url.includes('?') ? '&' : '?'}limit=50&page=${page}`)
        .expect(200);
      const parsed = parse(data(res));
      const found = parsed.items.find((item) => item.id === id);
      if (found) return found;
      if (page * 50 >= parsed.total) return undefined;
    }
    return undefined;
  }
  const inRequests = (status: string, id: string) =>
    findInList(
      `/api/v1/admin/refund-requests?status=${status}`,
      (raw) => adminRefundRequestListResponseSchema.parse(raw),
      id,
    );
  const inRefunds = (status: string, id: string) =>
    findInList(
      `/api/v1/admin/refunds?status=${status}`,
      (raw) => adminRefundListResponseSchema.parse(raw),
      id,
    );
  const inRefundable = (id: string) =>
    findInList(
      '/api/v1/admin/refundable-payments',
      (raw) => adminRefundablePaymentListResponseSchema.parse(raw),
      id,
    );

  const decide = (
    requestId: string,
    payload: { decision?: string; note?: string },
    agent: Agent = admin,
  ) =>
    agent
      .post(`/api/v1/admin/refund-requests/${requestId}/decide`)
      .send(payload);
  const retry = (refundId: string, agent: Agent = admin) =>
    agent.post(`/api/v1/admin/refunds/${refundId}/retry`);
  const markCompleted = (
    refundId: string,
    payload: { reference?: string },
    agent: Agent = admin,
  ) =>
    agent
      .post(`/api/v1/admin/refunds/${refundId}/mark-completed`)
      .send(payload);
  const refundPayment = (
    paymentId: string,
    payload: { reason?: string } = {},
    agent: Agent = admin,
  ) => agent.post(`/api/v1/admin/payments/${paymentId}/refund`).send(payload);

  beforeAll(async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên thay vì để supertest tự listen/close theo từng request: các test race bắn
    // nhiều request song song, request nào xong trước sẽ đóng server dưới chân các request còn lại ⇒ ECONNRESET
    // ngẫu nhiên (đã gặp: 1/10 lượt chạy của test 6 người đánh giá đồng thời).
    await app.listen(0);

    const first = await createAdmin('admin1');
    const second = await createAdmin('admin2');
    admin = first.agent;
    adminId = first.userId;
    secondAdmin = second.agent;

    plainUser = newAgent();
    const email = `${TAG}${stamp}user@test.local`;
    await plainUser
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}user` })
      .expect(201);
    await loginAs(plainUser, email);
    anonymous = newAgent();
  });

  afterEach(() => {
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
    fakeMail.reset();
  });

  afterAll(async () => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('PAYMENT_MOCK_ENABLED', originalEnv.mock);
    restore('PAYMENT_MOCK_REFUND_FAIL', originalEnv.fail);
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // --- Quyền truy cập ----------------------------------------------------------------------------

  describe('quyền truy cập (RolesGuard thật)', () => {
    let order: Seeded;
    let requestId: string;
    let refundId: string;

    beforeAll(async () => {
      order = await seedOrder({ status: 'CONFIRMED' });
      requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'ESCALATED',
      });
      refundId = await seedRefund(order, { status: 'FAILED' });
    });

    const routes = (): [string, string, object | undefined][] => [
      ['get', '/api/v1/admin/refund-requests', undefined],
      [
        'post',
        `/api/v1/admin/refund-requests/${requestId}/decide`,
        { decision: 'APPROVE' },
      ],
      ['get', '/api/v1/admin/refunds', undefined],
      ['post', `/api/v1/admin/refunds/${refundId}/retry`, undefined],
      [
        'post',
        `/api/v1/admin/refunds/${refundId}/mark-completed`,
        { reference: 'X' },
      ],
      ['get', '/api/v1/admin/refundable-payments', undefined],
      ['post', `/api/v1/admin/payments/${order.paymentId}/refund`, {}],
    ];

    it('chưa đăng nhập — 401 cả 7 route', async () => {
      for (const [method, url, payload] of routes()) {
        const res =
          method === 'get'
            ? await anonymous.get(url)
            : await anonymous.post(url).send(payload);
        expect([method, url, res.status]).toEqual([method, url, 401]);
      }
    });

    it('user thường — 403 cả 7 route, không có gì bị đổi', async () => {
      for (const [method, url, payload] of routes()) {
        const res =
          method === 'get'
            ? await plainUser.get(url)
            : await plainUser.post(url).send(payload);
        expect([method, url, res.status]).toEqual([method, url, 403]);
      }

      expect((await requestOf(requestId)).status).toBe('ESCALATED');
      expect(await orderStatusOf(order.orderId)).toBe('CONFIRMED');
      expect((await refundsOf(order.paymentId))[0].status).toBe('FAILED');
    });
  });

  // --- Hàng chờ yêu cầu --------------------------------------------------------------------------

  describe('GET /admin/refund-requests', () => {
    it('mặc định = ESCALATED: thấy yêu cầu đã lên sàn, KHÔNG thấy yêu cầu còn chờ seller; item parse được bằng schema dùng chung, kèm người mua / shop / tóm tắt đơn, timeline không lộ actorId', async () => {
      const escalatedOrder = await seedOrder({ status: 'COMPLETED' });
      const pendingOrder = await seedOrder({ status: 'COMPLETED' });
      const escalatedId = await seedRequest(escalatedOrder, {
        kind: 'RETURN',
        status: 'ESCALATED',
      });
      const pendingId = await seedRequest(pendingOrder, {
        kind: 'RETURN',
        status: 'PENDING_SELLER',
      });

      const res = await admin.get('/api/v1/admin/refund-requests').expect(200);
      adminRefundRequestListResponseSchema.parse(data(res));

      const found = await findInList(
        '/api/v1/admin/refund-requests',
        (raw) => adminRefundRequestListResponseSchema.parse(raw),
        escalatedId,
      );
      expect(found).toMatchObject({
        kind: 'RETURN',
        status: 'ESCALATED',
        reasonCode: 'DAMAGED',
        reasonNote: 'Ghi chú của người mua',
        canApprove: true,
        canReject: true,
        order: {
          id: escalatedOrder.orderId,
          status: 'COMPLETED',
          totalAmount: String(TOTAL),
          paymentMethod: 'VNPAY',
          paymentStatus: 'SUCCESS',
          refund: null,
        },
      });
      expect(found?.buyer.email).toMatch(new RegExp(`^${TAG}`));
      expect(found?.shop.name).toBe(`${TAG}shop`);
      expect(found?.history.map((h) => h.toStatus)).toEqual([
        'PENDING_SELLER',
        'REJECTED_BY_SELLER',
        'ESCALATED',
      ]);
      for (const entry of found?.history ?? []) {
        expect(entry).not.toHaveProperty('actorId');
      }
      expect(await inRequests('ESCALATED', pendingId)).toBeUndefined();
    });

    it('?status=PENDING_SELLER thấy yêu cầu còn chờ seller (Admin có thể thay seller vắng mặt); ?status=WITHDRAWN cũng xem được (khác seller)', async () => {
      const pendingOrder = await seedOrder({ status: 'CONFIRMED' });
      const withdrawnOrder = await seedOrder({ status: 'CONFIRMED' });
      const pendingId = await seedRequest(pendingOrder, {
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });
      const withdrawnId = await seedRequest(withdrawnOrder, {
        kind: 'CANCEL',
        status: 'WITHDRAWN',
      });

      expect(await inRequests('PENDING_SELLER', pendingId)).toMatchObject({
        canApprove: true,
        canReject: true,
      });
      expect(await inRequests('WITHDRAWN', withdrawnId)).toMatchObject({
        canApprove: false,
        canReject: false,
      });
    });

    it('hàng chờ ESCALATED xếp CŨ NHẤT TRƯỚC theo lúc lên sàn (statusChangedAt)', async () => {
      const older = await seedOrder({ status: 'COMPLETED' });
      const newer = await seedOrder({ status: 'COMPLETED' });
      // Tạo yêu cầu "mới" trước để chứng minh thứ tự không theo thứ tự chèn / createdAt.
      const newerId = await seedRequest(newer, {
        kind: 'RETURN',
        status: 'ESCALATED',
        statusChangedAt: new Date(Date.now() - 1 * HOUR_MS),
      });
      const olderId = await seedRequest(older, {
        kind: 'RETURN',
        status: 'ESCALATED',
        statusChangedAt: new Date(Date.now() - 5 * HOUR_MS),
      });

      const ids: string[] = [];
      for (let page = 1; page <= 20; page++) {
        const res = await admin
          .get(`/api/v1/admin/refund-requests?limit=50&page=${page}`)
          .expect(200);
        const parsed = adminRefundRequestListResponseSchema.parse(data(res));
        ids.push(...parsed.items.map((item) => item.id));
        if (page * 50 >= parsed.total) break;
      }

      expect(ids.indexOf(olderId)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(olderId)).toBeLessThan(ids.indexOf(newerId));
    });

    it('query sai ⇒ 400', async () => {
      await admin.get('/api/v1/admin/refund-requests?status=BAD').expect(400);
      await admin.get('/api/v1/admin/refund-requests?limit=51').expect(400);
      await admin.get('/api/v1/admin/refund-requests?page=0').expect(400);
    });
  });

  // --- Quyết định yêu cầu ------------------------------------------------------------------------

  describe('POST /admin/refund-requests/:id/decide', () => {
    it('APPROVE yêu cầu HỦY đã lên sàn (đơn online CONFIRMED) ⇒ hủy đơn, kho cộng lại, hoàn tiền SUCCEEDED, Payment REFUNDED; timeline ghi ADMIN + ghi chú (actorId chỉ ở DB); response parse được và các cờ tắt', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'ESCALATED',
      });

      const res = await decide(requestId, {
        decision: 'APPROVE',
        note: 'Shop không phản hồi',
      });

      expect(res.status).toBe(200);
      const item = adminRefundRequestSchema.parse(data(res));
      expect(item).toMatchObject({
        status: 'APPROVED',
        canApprove: false,
        canReject: false,
        order: { status: 'CANCELLED', refund: { status: 'SUCCEEDED' } },
      });
      expect(item.history.at(-1)).toMatchObject({
        toStatus: 'APPROVED',
        actorType: 'ADMIN',
        note: 'Shop không phản hồi',
      });
      expect(item.history.at(-1)).not.toHaveProperty('actorId');

      expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
      expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(TOTAL);
      const [refund] = await refundsOf(order.paymentId);
      expect(refund).toMatchObject({
        orderId: order.orderId,
        status: 'SUCCEEDED',
        initiatedByType: 'ADMIN',
        initiatedById: adminId,
      });
      expect(refund.refundRequestId).toBe(requestId);

      const stored = await requestOf(requestId);
      expect(stored.history.at(-1)).toMatchObject({
        fromStatus: 'ESCALATED',
        toStatus: 'APPROVED',
        actorType: 'ADMIN',
        actorId: adminId,
      });
    });

    it('APPROVE yêu cầu TRẢ HÀNG còn chờ seller (Admin thay seller vắng mặt) ⇒ COMPLETED → REFUNDED, hoàn tiền, KHÔNG cộng kho', async () => {
      const order = await seedOrder({ status: 'COMPLETED' });
      const requestId = await seedRequest(order, {
        kind: 'RETURN',
        status: 'PENDING_SELLER',
      });

      const res = await decide(requestId, { decision: 'APPROVE' });

      expect(res.status).toBe(200);
      expect(await orderStatusOf(order.orderId)).toBe('REFUNDED');
      expect(await stockOf(order.variantId)).toBe(STOCK);
      expect((await paymentOf(order.paymentId)).status).toBe('REFUNDED');
      expect((await requestOf(requestId)).status).toBe('APPROVED');
      expect((await requestOf(requestId)).history.at(-1)?.note).toBeNull();
    });

    it('REJECT kèm ghi chú ⇒ REJECTED, đơn / kho / tiền KHÔNG đổi, ghi chú nằm trong timeline mà người mua đọc được', async () => {
      const order = await seedOrder({ status: 'COMPLETED' });
      const requestId = await seedRequest(order, {
        kind: 'RETURN',
        status: 'ESCALATED',
      });

      const res = await decide(requestId, {
        decision: 'REJECT',
        note: 'Ảnh không cho thấy lỗi như mô tả',
      });

      expect(res.status).toBe(200);
      const item = adminRefundRequestSchema.parse(data(res));
      expect(item.status).toBe('REJECTED');
      expect(item.history.at(-1)).toMatchObject({
        toStatus: 'REJECTED',
        actorType: 'ADMIN',
        note: 'Ảnh không cho thấy lỗi như mô tả',
      });
      expect(await orderStatusOf(order.orderId)).toBe('COMPLETED');
      expect(await refundsOf(order.paymentId)).toHaveLength(0);
      expect((await paymentOf(order.paymentId)).status).toBe('SUCCESS');
    });

    it('REJECT không ghi chú ⇒ 400 báo theo field note, yêu cầu giữ nguyên', async () => {
      const order = await seedOrder({ status: 'COMPLETED' });
      const requestId = await seedRequest(order, {
        kind: 'RETURN',
        status: 'ESCALATED',
      });

      const res = await decide(requestId, { decision: 'REJECT', note: '   ' });

      expect(res.status).toBe(400);
      expect(message(res)).toContain('order.validationReasonRequired');
      expect((await requestOf(requestId)).status).toBe('ESCALATED');
    });

    it('decision lạ / thiếu / ghi chú quá dài ⇒ 400', async () => {
      const order = await seedOrder({ status: 'COMPLETED' });
      const requestId = await seedRequest(order, {
        kind: 'RETURN',
        status: 'ESCALATED',
      });

      await decide(requestId, { decision: 'MAYBE' }).expect(400);
      await decide(requestId, {}).expect(400);
      await decide(requestId, {
        decision: 'APPROVE',
        note: 'x'.repeat(501),
      }).expect(400);
      expect((await requestOf(requestId)).status).toBe('ESCALATED');
    });

    it('yêu cầu không tồn tại ⇒ 404 REFUND_REQUEST_NOT_FOUND', async () => {
      const res = await decide('00000000-0000-4000-8000-000000000000', {
        decision: 'APPROVE',
      });

      expect(res.status).toBe(404);
      expect(code(res)).toBe('REFUND_REQUEST_NOT_FOUND');
    });

    it.each([
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
      'REJECTED_BY_SELLER',
    ] as const)(
      'yêu cầu đang %s ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION (cả duyệt lẫn từ chối), không đụng tới đơn',
      async (status) => {
        const order = await seedOrder({ status: 'COMPLETED' });
        const requestId = await seedRequest(order, { kind: 'RETURN', status });

        for (const payload of [
          { decision: 'APPROVE' },
          { decision: 'REJECT', note: 'x' },
        ]) {
          const res = await decide(requestId, payload);
          expect(res.status).toBe(409);
          expect(code(res)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
        }
        expect((await requestOf(requestId)).status).toBe(status);
        expect(await orderStatusOf(order.orderId)).toBe('COMPLETED');
        expect(await refundsOf(order.paymentId)).toHaveLength(0);
      },
    );

    it('RACE: hai Admin quyết định ĐỒNG THỜI cùng một yêu cầu (5 vòng) — đúng một bên thắng, bên kia 409; đơn hủy một lần, một khoản hoàn, kho cộng một lần', async () => {
      for (let round = 0; round < 5; round++) {
        const order = await seedOrder({ status: 'CONFIRMED' });
        const requestId = await seedRequest(order, {
          kind: 'CANCEL',
          status: 'ESCALATED',
        });

        const [a, b] = await Promise.all([
          decide(requestId, { decision: 'APPROVE' }, admin),
          decide(requestId, { decision: 'APPROVE' }, secondAdmin),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const loser = a.status === 409 ? a : b;
        // Bên thua gặp 1 trong 3 lỗi tuỳ lúc nó lấy được khoá: yêu cầu đã đóng, đơn đã đổi, hoặc Payment đã REFUNDED.
        expect([
          'REFUND_REQUEST_INVALID_TRANSITION',
          'ORDER_ALREADY_CHANGED',
          'PAYMENT_NOT_REFUNDABLE',
        ]).toContain(code(loser));
        expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
        expect(await refundsOf(order.paymentId)).toHaveLength(1);
        expect(await stockOf(order.variantId)).toBe(STOCK + QTY);
        const stored = await requestOf(requestId);
        expect(
          stored.history.filter((h) => h.toStatus === 'APPROVED'),
        ).toHaveLength(1);
      }
    });

    it('RACE: một Admin duyệt, một Admin từ chối ĐỒNG THỜI — đúng một quyết định có hiệu lực, trạng thái đơn khớp quyết định đó', async () => {
      for (let round = 0; round < 5; round++) {
        const order = await seedOrder({ status: 'CONFIRMED' });
        const requestId = await seedRequest(order, {
          kind: 'CANCEL',
          status: 'ESCALATED',
        });

        const [approve, reject] = await Promise.all([
          decide(requestId, { decision: 'APPROVE' }, admin),
          decide(
            requestId,
            { decision: 'REJECT', note: 'Không đồng ý' },
            secondAdmin,
          ),
        ]);

        expect([approve.status, reject.status].sort()).toEqual([200, 409]);
        const stored = await requestOf(requestId);
        if (approve.status === 200) {
          expect(stored.status).toBe('APPROVED');
          expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
          expect(await refundsOf(order.paymentId)).toHaveLength(1);
        } else {
          expect(stored.status).toBe('REJECTED');
          expect(await orderStatusOf(order.orderId)).toBe('CONFIRMED');
          expect(await refundsOf(order.paymentId)).toHaveLength(0);
        }
      }
    });

    it('cổng từ chối hoàn (PAYMENT_MOCK_REFUND_FAIL) ⇒ vẫn 200: yêu cầu APPROVED, đơn CANCELLED, khoản hoàn FAILED hiện ở hàng "cần xử lý" với cờ thử lại; bỏ lỗi rồi retry ⇒ SUCCEEDED', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'ESCALATED',
      });

      const res = await decide(requestId, { decision: 'APPROVE' });

      expect(res.status).toBe(200);
      expect(
        adminRefundRequestSchema.parse(data(res)).order.refund,
      ).toMatchObject({
        status: 'FAILED',
      });
      expect(await orderStatusOf(order.orderId)).toBe('CANCELLED');
      const [refund] = await refundsOf(order.paymentId);
      expect(refund.status).toBe('FAILED');

      const listed = await inRefunds('NEEDS_ACTION', refund.id);
      expect(listed).toMatchObject({
        status: 'FAILED',
        canRetry: true,
        canMarkCompleted: true,
        order: { id: order.orderId },
      });
      expect(listed?.failureReason).toMatch(/PAYMENT_MOCK_REFUND_FAIL/);

      delete process.env.PAYMENT_MOCK_REFUND_FAIL;
      const retried = await retry(refund.id);
      expect(retried.status).toBe(200);
      expect(adminRefundSchema.parse(data(retried))).toMatchObject({
        status: 'SUCCEEDED',
        canRetry: false,
      });
      expect((await paymentOf(order.paymentId)).status).toBe('REFUNDED');
    });
  });

  // --- Sổ cái hoàn tiền --------------------------------------------------------------------------

  describe('GET /admin/refunds', () => {
    it('mặc định NEEDS_ACTION = FAILED + PENDING bỏ dở; KHÔNG có PENDING còn mới và SUCCEEDED; cờ canRetry khớp; item parse được và kèm người mua + mã giao dịch', async () => {
      const failedOrder = await seedOrder({ status: 'CANCELLED' });
      const stalePending = await seedOrder({ status: 'CANCELLED' });
      const freshPending = await seedOrder({ status: 'CANCELLED' });
      const succeeded = await seedOrder({ status: 'CANCELLED' });
      const failedId = await seedRefund(failedOrder, {
        status: 'FAILED',
        ageMs: 0,
      });
      const staleId = await seedRefund(stalePending, {
        status: 'PENDING',
        ageMs: 6 * MIN_MS,
      });
      const freshId = await seedRefund(freshPending, {
        status: 'PENDING',
        ageMs: 1 * MIN_MS,
      });
      const doneId = await seedRefund(succeeded, { status: 'SUCCEEDED' });

      const res = await admin.get('/api/v1/admin/refunds').expect(200);
      adminRefundListResponseSchema.parse(data(res));

      const failed = await inRefunds('NEEDS_ACTION', failedId);
      expect(failed).toMatchObject({
        status: 'FAILED',
        failureReason: 'Gateway said no',
        amount: String(TOTAL),
        canRetry: true,
        canMarkCompleted: true,
        order: { id: failedOrder.orderId },
      });
      expect(failed?.buyer.email).toMatch(new RegExp(`^${TAG}`));
      expect(failed?.payment.transactionId).toMatch(/^GW-/);
      expect((await inRefunds('NEEDS_ACTION', staleId))?.canRetry).toBe(true);
      expect(await inRefunds('NEEDS_ACTION', freshId)).toBeUndefined();
      expect(await inRefunds('NEEDS_ACTION', doneId)).toBeUndefined();

      // PENDING mới vẫn xem được ở bộ lọc PENDING nhưng chưa thử lại được (lần gọi cổng có thể đang chạy).
      expect(await inRefunds('PENDING', freshId)).toMatchObject({
        canRetry: false,
        canMarkCompleted: false,
      });
      expect(await inRefunds('SUCCEEDED', doneId)).toMatchObject({
        status: 'SUCCEEDED',
        canRetry: false,
      });
      expect(await inRefunds('FAILED', failedId)).toBeDefined();
    });

    it('hoàn thanh toán bất thường (không gắn đơn) ⇒ order = null', async () => {
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, {
        status: 'FAILED',
        attached: false,
      });

      expect((await inRefunds('NEEDS_ACTION', refundId))?.order).toBeNull();
    });

    it('query sai ⇒ 400', async () => {
      await admin.get('/api/v1/admin/refunds?status=BAD').expect(400);
      await admin.get('/api/v1/admin/refunds?limit=51').expect(400);
    });
  });

  describe('POST /admin/refunds/:id/retry', () => {
    it('khoản FAILED ⇒ gọi cổng lại bằng CÙNG dòng: SUCCEEDED, Payment REFUNDED; gọi lần 2 ⇒ 409 NOT_RETRYABLE, không hoàn thêm', async () => {
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, { status: 'FAILED' });

      const res = await retry(refundId);

      expect(res.status).toBe(200);
      expect(adminRefundSchema.parse(data(res))).toMatchObject({
        id: refundId,
        status: 'SUCCEEDED',
        failureReason: null,
        attempts: 2,
      });
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(TOTAL);

      const again = await retry(refundId);
      expect(again.status).toBe(409);
      expect(code(again)).toBe('PAYMENT_REFUND_NOT_RETRYABLE');
      expect(Number((await paymentOf(order.paymentId)).refundedAmount)).toBe(
        TOTAL,
      );
      expect(await refundsOf(order.paymentId)).toHaveLength(1);
    });

    it('PENDING bỏ dở (quá 5 phút) thử lại được; PENDING còn mới ⇒ 409 NOT_RETRYABLE, không gọi cổng', async () => {
      const staleOrder = await seedOrder({ status: 'CANCELLED' });
      const freshOrder = await seedOrder({ status: 'CANCELLED' });
      const staleId = await seedRefund(staleOrder, {
        status: 'PENDING',
        ageMs: 10 * MIN_MS,
      });
      const freshId = await seedRefund(freshOrder, {
        status: 'PENDING',
        ageMs: 30 * 1000,
      });

      expect((await retry(staleId)).status).toBe(200);
      const fresh = await retry(freshId);
      expect(fresh.status).toBe(409);
      expect(code(fresh)).toBe('PAYMENT_REFUND_NOT_RETRYABLE');
      expect((await refundsOf(freshOrder.paymentId))[0]).toMatchObject({
        status: 'PENDING',
        attempts: 1,
      });
    });

    it('cổng vẫn từ chối ⇒ 200 với khoản hoàn vẫn FAILED (Admin thử lại được tiếp); khoản không tồn tại ⇒ 404', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, { status: 'FAILED' });

      const res = await retry(refundId);

      expect(res.status).toBe(200);
      expect(adminRefundSchema.parse(data(res))).toMatchObject({
        status: 'FAILED',
        canRetry: true,
      });
      expect((await paymentOf(order.paymentId)).status).toBe('SUCCESS');

      const missing = await retry('00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(404);
      expect(code(missing)).toBe('PAYMENT_REFUND_NOT_FOUND');
    });
  });

  describe('POST /admin/refunds/:id/mark-completed', () => {
    it('ghi nhận đã hoàn thủ công: SUCCEEDED với gatewayRef MANUAL:<mã>, Payment REFUNDED; gọi lại cùng mã ⇒ 200 idempotent (không cộng lần hai); mã khác sau khi xong ⇒ 409', async () => {
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, { status: 'FAILED' });

      const res = await markCompleted(refundId, {
        reference: '  VNP-REFUND-001 ',
      });

      expect(res.status).toBe(200);
      expect(adminRefundSchema.parse(data(res))).toMatchObject({
        status: 'SUCCEEDED',
        gatewayRef: 'MANUAL:VNP-REFUND-001',
        canRetry: false,
      });
      const payment = await paymentOf(order.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(TOTAL);

      const same = await markCompleted(refundId, {
        reference: 'VNP-REFUND-001',
      });
      expect(same.status).toBe(200);
      expect(Number((await paymentOf(order.paymentId)).refundedAmount)).toBe(
        TOTAL,
      );

      const other = await markCompleted(refundId, { reference: 'OTHER' });
      expect(other.status).toBe(409);
      expect(code(other)).toBe('PAYMENT_REFUND_NOT_RETRYABLE');
    });

    it('thiếu / rỗng / quá dài mã tham chiếu ⇒ 400 báo theo field reference, khoản hoàn không đổi', async () => {
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, { status: 'FAILED' });

      const missing = await admin.post(
        `/api/v1/admin/refunds/${refundId}/mark-completed`,
      );
      const blank = await markCompleted(refundId, { reference: '   ' });
      const tooLong = await markCompleted(refundId, {
        reference: 'x'.repeat(101),
      });

      for (const res of [missing, blank]) {
        expect(res.status).toBe(400);
        expect(message(res)).toContain(
          'admin.validationRefundReferenceRequired',
        );
      }
      expect(tooLong.status).toBe(400);
      expect(message(tooLong)).toContain(
        'admin.validationRefundReferenceTooLong',
      );
      expect((await refundsOf(order.paymentId))[0].status).toBe('FAILED');
    });

    it('PENDING còn mới ⇒ 409 (không đua với lần gọi cổng đang chạy); khoản không tồn tại ⇒ 404', async () => {
      const order = await seedOrder({ status: 'CANCELLED' });
      const refundId = await seedRefund(order, {
        status: 'PENDING',
        ageMs: 20 * 1000,
      });

      const res = await markCompleted(refundId, { reference: 'X' });
      expect(res.status).toBe(409);
      expect(code(res)).toBe('PAYMENT_REFUND_NOT_RETRYABLE');

      const missing = await markCompleted(
        '00000000-0000-4000-8000-000000000000',
        {
          reference: 'X',
        },
      );
      expect(missing.status).toBe(404);
    });
  });

  // --- Thanh toán bất thường ---------------------------------------------------------------------

  describe('GET /admin/refundable-payments + POST /admin/payments/:id/refund', () => {
    let afterExpiry: Seeded;
    let duplicate: Seeded;
    let normal: Seeded;
    let cod: Seeded;
    let alreadyRefunded: Seeded;
    let partlyCancelled: Seeded;

    beforeAll(async () => {
      afterExpiry = await seedOrder({ status: 'CANCELLED' });
      // Khách trả hai lần: bản thứ hai (muộn hơn) mới là bản dư; đơn vẫn sống.
      duplicate = await seedOrder({
        status: 'PENDING',
        paidAt: new Date(Date.now() - 3 * HOUR_MS),
        extraPayment: { paidAt: new Date(Date.now() - 2 * HOUR_MS) },
      });
      normal = await seedOrder({ status: 'PENDING' });
      cod = await seedOrder({
        status: 'CANCELLED',
        method: 'COD',
        paymentStatus: 'SUCCESS',
        paidAt: new Date(),
      });
      alreadyRefunded = await seedOrder({ status: 'CANCELLED' });
      await seedRefund(alreadyRefunded, { status: 'FAILED', attached: false });
      // Nhóm có thêm một đơn còn sống ⇒ không phải PAID_AFTER_EXPIRY.
      partlyCancelled = await seedOrder({ status: 'CANCELLED' });
      await prisma.order.create({
        data: {
          userId: partlyCancelled.buyerId,
          shopId: partlyCancelled.shopId,
          checkoutGroupId: partlyCancelled.groupId,
          status: 'PENDING',
          totalAmount: 1000,
          recipientName: 'A',
          recipientPhone: '0900000000',
          shippingAddressLine: 'x',
          shippingWard: 'x',
          shippingProvince: 'Hồ Chí Minh',
        },
      });
    });

    it('chỉ liệt kê PAID_AFTER_EXPIRY và bản thanh toán trùng DƯ; không liệt kê thanh toán bình thường, COD, đã có dòng hoàn, nhóm còn đơn sống, hay bản thanh toán trùng ĐẾN TRƯỚC', async () => {
      const res = await admin
        .get('/api/v1/admin/refundable-payments')
        .expect(200);
      adminRefundablePaymentListResponseSchema.parse(data(res));

      expect(await inRefundable(afterExpiry.paymentId)).toMatchObject({
        kind: 'PAID_AFTER_EXPIRY',
        amount: String(TOTAL),
        orders: [{ id: afterExpiry.orderId, status: 'CANCELLED' }],
      });
      expect((await inRefundable(afterExpiry.paymentId))?.buyer.email).toMatch(
        new RegExp(`^${TAG}`),
      );
      expect(await inRefundable(duplicate.extraPaymentId!)).toMatchObject({
        kind: 'DUPLICATE',
        checkoutGroupId: duplicate.groupId,
        orders: [{ id: duplicate.orderId, status: 'PENDING' }],
      });

      for (const excluded of [
        duplicate.paymentId, // bản SUCCESS sớm nhất của nhóm
        normal.paymentId,
        cod.paymentId,
        alreadyRefunded.paymentId,
        partlyCancelled.paymentId,
      ]) {
        expect(await inRefundable(excluded)).toBeUndefined();
      }
    });

    it('phân trang: limit=1 trả đúng 1 dòng, total đếm đủ cả hai khoản bất thường của test', async () => {
      const res = await admin
        .get('/api/v1/admin/refundable-payments?limit=1&page=1')
        .expect(200);
      const parsed = adminRefundablePaymentListResponseSchema.parse(data(res));

      expect(parsed.items).toHaveLength(1);
      expect(parsed.total).toBeGreaterThanOrEqual(2);
      await admin.get('/api/v1/admin/refundable-payments?limit=51').expect(400);
    });

    it('POST refund PAID_AFTER_EXPIRY ⇒ hoàn TOÀN BỘ, order = null; CHỈ chuyển tiền: đơn đã hủy giữ nguyên, kho KHÔNG đổi; rồi khỏi danh sách; gọi lại ⇒ 409', async () => {
      const stockBefore = await stockOf(afterExpiry.variantId);

      const res = await refundPayment(afterExpiry.paymentId, {
        reason: 'Tiền đến sau khi đơn bị hủy',
      });

      expect(res.status).toBe(200);
      expect(adminRefundSchema.parse(data(res))).toMatchObject({
        status: 'SUCCEEDED',
        amount: String(TOTAL),
        reason: 'Tiền đến sau khi đơn bị hủy',
        initiatedByType: 'ADMIN',
        order: null,
      });
      const payment = await paymentOf(afterExpiry.paymentId);
      expect(payment.status).toBe('REFUNDED');
      expect(Number(payment.refundedAmount)).toBe(TOTAL);
      expect(await orderStatusOf(afterExpiry.orderId)).toBe('CANCELLED');
      expect(await stockOf(afterExpiry.variantId)).toBe(stockBefore);
      const [refund] = await refundsOf(afterExpiry.paymentId);
      expect(refund).toMatchObject({
        orderId: null,
        refundRequestId: null,
        initiatedById: adminId,
      });

      expect(await inRefundable(afterExpiry.paymentId)).toBeUndefined();
      const again = await refundPayment(afterExpiry.paymentId);
      expect(again.status).toBe(409);
      expect(code(again)).toBe('PAYMENT_NOT_REFUNDABLE');
      expect(await refundsOf(afterExpiry.paymentId)).toHaveLength(1);
    });

    it('POST refund bản thanh toán trùng ⇒ chỉ hoàn bản DƯ; bản đầu, đơn (vẫn PENDING) và kho không đổi', async () => {
      const stockBefore = await stockOf(duplicate.variantId);

      const res = await refundPayment(duplicate.extraPaymentId!);

      expect(res.status).toBe(200);
      expect((await paymentOf(duplicate.extraPaymentId!)).status).toBe(
        'REFUNDED',
      );
      expect((await paymentOf(duplicate.paymentId)).status).toBe('SUCCESS');
      expect(await refundsOf(duplicate.paymentId)).toHaveLength(0);
      expect(await orderStatusOf(duplicate.orderId)).toBe('PENDING');
      expect(await stockOf(duplicate.variantId)).toBe(stockBefore);
    });

    it('POST refund thanh toán BÌNH THƯỜNG / bản trùng đến trước / COD / đã có dòng hoàn ⇒ 409 PAYMENT_NOT_REFUNDABLE, không tạo gì', async () => {
      for (const paymentId of [
        duplicate.paymentId, // bản trùng đến TRƯỚC: không bất thường
        normal.paymentId,
        cod.paymentId,
        alreadyRefunded.paymentId,
        partlyCancelled.paymentId,
      ]) {
        const res = await refundPayment(paymentId);
        expect([paymentId, res.status, code(res)]).toEqual([
          paymentId,
          409,
          'PAYMENT_NOT_REFUNDABLE',
        ]);
      }
      expect(await refundsOf(normal.paymentId)).toHaveLength(0);
      expect(await refundsOf(cod.paymentId)).toHaveLength(0);
      expect(await refundsOf(alreadyRefunded.paymentId)).toHaveLength(1);
      expect((await paymentOf(normal.paymentId)).status).toBe('SUCCESS');
    });

    it('Payment không tồn tại ⇒ 404; lý do quá dài ⇒ 400', async () => {
      const missing = await refundPayment(
        '00000000-0000-4000-8000-000000000000',
      );
      expect(missing.status).toBe(404);

      const long = await refundPayment(afterExpiry.paymentId, {
        reason: 'x'.repeat(501),
      });
      expect(long.status).toBe(400);
      expect(message(long)).toContain('admin.validationReasonTooLong');
    });

    it('RACE: hai Admin hoàn cùng một thanh toán bất thường ĐỒNG THỜI — đúng một khoản hoàn, tổng hoàn không vượt số đã thu', async () => {
      for (let round = 0; round < 3; round++) {
        const order = await seedOrder({ status: 'CANCELLED' });

        const [a, b] = await Promise.all([
          refundPayment(order.paymentId, {}, admin),
          refundPayment(order.paymentId, {}, secondAdmin),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect(await refundsOf(order.paymentId)).toHaveLength(1);
        expect(Number((await paymentOf(order.paymentId)).refundedAmount)).toBe(
          TOTAL,
        );
      }
    });
  });
});
