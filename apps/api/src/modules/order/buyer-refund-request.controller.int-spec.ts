import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type RefundRequestKind,
  type RefundRequestStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { orderDetailSchema, orderListResponseSchema } from '@ecommerce/types';
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

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho các route yêu cầu hủy/trả hàng của NGƯỜI MUA
// (Week9.md 2.6): gửi yêu cầu (POST /orders/:id/refund-requests), rút và khiếu nại lên sàn
// (POST /refund-requests/:id/withdraw|escalate). Chứng minh điều unit test với mock không chứng minh được: loại
// yêu cầu suy đúng từ trạng thái đơn, index duy nhất từng phần chặn gửi trùng kể cả khi hai lần gửi đồng thời,
// dòng thời gian không lộ danh tính, người khác không đụng được yêu cầu của mình, và response parse được bằng
// đúng Zod schema FE sẽ dùng. Chạy: `pnpm test:int`.
const TAG = 'it-buyer-refund-';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface SeedOrder {
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  // Lúc đơn chuyển sang `status` (mốc COMPLETED cho cửa sổ trả hàng).
  statusAt?: Date;
}

const fakeMail = createFakeMail();

describe('Yêu cầu hủy/trả hàng của người mua (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  let buyer: ReturnType<typeof newAgent>;
  let other: ReturnType<typeof newAgent>;
  let anonymous: ReturnType<typeof newAgent>;
  let buyerId: string;

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

  // Đơn của buyer với lịch sử trạng thái thật và một Payment cho nhóm (online SUCCESS mặc định).
  async function seedOrder(input: SeedOrder) {
    const method = input.paymentMethod ?? 'VNPAY';
    const group = await createCheckoutGroup(prisma, buyerId);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 10 });
    const history = seedOrderHistory(input.status, { isCod: method === 'COD' });
    const order = await prisma.order.create({
      data: {
        userId: buyerId,
        shopId: base.shopId,
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
              quantity: 2,
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
            // Dòng cuối (= trạng thái hiện tại) dùng mốc do test đặt, để đóng cửa sổ trả hàng tường minh.
            createdAt:
              index === history.length - 1 && input.statusAt
                ? input.statusAt
                : row.createdAt,
          })),
        },
      },
      select: { id: true, shopId: true },
    });
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status:
          input.paymentStatus ?? (method === 'COD' ? 'PENDING' : 'SUCCESS'),
        amount: 220_000,
        txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
        expiresAt: null,
        paidAt: method === 'COD' ? null : new Date(Date.now() - 60_000),
      },
    });
    return { orderId: order.id, shopId: order.shopId };
  }

  // Yêu cầu ở trạng thái bất kỳ (dựng thẳng bằng Prisma, kèm dòng thời gian khớp trạng thái).
  async function seedRequest(
    order: { orderId: string; shopId: string },
    options: {
      kind: RefundRequestKind;
      status: RefundRequestStatus;
      statusChangedAt?: Date;
      sellerNote?: string;
    },
  ) {
    // Yêu cầu được tạo TRƯỚC lần đổi trạng thái gần nhất (cùng thứ tự với dòng thời gian thật).
    const createdAt = new Date(
      (options.statusChangedAt ?? new Date()).getTime() - 2 * HOUR_MS,
    );
    const request = await prisma.refundRequest.create({
      data: {
        orderId: order.orderId,
        shopId: order.shopId,
        userId: buyerId,
        kind: options.kind,
        status: options.status,
        reasonCode: options.kind === 'CANCEL' ? 'CHANGE_OF_MIND' : 'DAMAGED',
        sellerRespondBy: new Date(Date.now() + 46 * HOUR_MS),
        statusChangedAt: options.statusChangedAt ?? createdAt,
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
            ...(options.status !== 'PENDING_SELLER'
              ? [
                  {
                    fromStatus: 'PENDING_SELLER' as const,
                    toStatus: options.status,
                    actorType: 'SELLER' as const,
                    actorId: 'seller-secret-id',
                    note: options.sellerNote ?? null,
                    createdAt: options.statusChangedAt ?? new Date(),
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

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const details = (res: { body: unknown }) =>
    (res.body as { details?: unknown }).details;
  const message = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  const createUrl = (orderId: string) =>
    `/api/v1/orders/${orderId}/refund-requests`;
  const actionUrl = (requestId: string, action: 'withdraw' | 'escalate') =>
    `/api/v1/refund-requests/${requestId}/${action}`;
  const cancelReason = { reasonCode: 'CHANGE_OF_MIND' };
  const returnReason = { reasonCode: 'DAMAGED', reasonNote: 'Vỡ góc hộp' };

  const requestsOf = (orderId: string) =>
    prisma.refundRequest.findMany({
      where: { orderId },
      include: { history: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
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

    const b = await registerAndLogin('buyer');
    const o = await registerAndLogin('other');
    buyer = b.agent;
    buyerId = b.userId;
    other = o.agent;
    anonymous = newAgent();
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /orders/:id/refund-requests — gửi yêu cầu', () => {
    it('đơn CONFIRMED ⇒ 201, yêu cầu HỦY chờ seller; chi tiết parse được bằng schema dùng chung, timeline không lộ actorId', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const before = Date.now();

      const res = await buyer
        .post(createUrl(order.orderId))
        .send({ reasonCode: 'OTHER', reasonNote: 'Đặt trùng đơn' });

      expect(res.status).toBe(201);
      const detail = orderDetailSchema.parse(data(res));
      expect(detail.refundRequest).toMatchObject({
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        reasonCode: 'OTHER',
        reasonNote: 'Đặt trùng đơn',
        canWithdraw: true,
        canEscalate: false,
        history: [
          { toStatus: 'PENDING_SELLER', actorType: 'BUYER', note: null },
        ],
      });
      expect(detail.refundRequest?.history[0]).not.toHaveProperty('actorId');
      // Đã có yêu cầu hủy ⇒ không xin thêm được nữa; đơn vẫn CONFIRMED (chờ seller).
      expect(detail).toMatchObject({
        status: 'CONFIRMED',
        canRequestCancel: false,
        canCancel: false,
      });
      // Hạn seller phản hồi mặc định 48 giờ kể từ lúc gửi.
      const respondBy = Date.parse(detail.refundRequest!.sellerRespondBy);
      expect(respondBy).toBeGreaterThanOrEqual(before + 48 * HOUR_MS - 1000);
      expect(respondBy).toBeLessThanOrEqual(Date.now() + 48 * HOUR_MS + 1000);

      // DB: đúng một yêu cầu, một dòng lịch sử mốc tạo — LƯU actorId người mua ở DB (chỉ không trả ra response).
      const [row] = await requestsOf(order.orderId);
      expect(row).toMatchObject({
        shopId: order.shopId,
        userId: buyerId,
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });
      expect(row.history).toHaveLength(1);
      expect(row.history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING_SELLER',
        actorType: 'BUYER',
        actorId: buyerId,
        note: null,
      });
    });

    it('đơn COMPLETED trong cửa sổ ⇒ 201, yêu cầu TRẢ HÀNG; đơn COD cũng gửi được', async () => {
      const online = await seedOrder({
        status: 'COMPLETED',
        statusAt: new Date(Date.now() - 2 * DAY_MS),
      });
      const cod = await seedOrder({
        status: 'COMPLETED',
        paymentMethod: 'COD',
        paymentStatus: 'SUCCESS',
        statusAt: new Date(Date.now() - 1 * DAY_MS),
      });

      const r1 = await buyer.post(createUrl(online.orderId)).send(returnReason);
      const r2 = await buyer.post(createUrl(cod.orderId)).send(returnReason);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(orderDetailSchema.parse(data(r1)).refundRequest).toMatchObject({
        kind: 'RETURN',
        status: 'PENDING_SELLER',
      });
      expect(orderDetailSchema.parse(data(r2)).canRequestReturn).toBe(false);
    });

    it('đơn COD CONFIRMED chưa thu tiền vẫn xin hủy được', async () => {
      const cod = await seedOrder({
        status: 'CONFIRMED',
        paymentMethod: 'COD',
      });

      const res = await buyer.post(createUrl(cod.orderId)).send(cancelReason);

      expect(res.status).toBe(201);
    });

    it('quá cửa sổ trả hàng (REFUND_WINDOW_DAYS = 7) ⇒ 409 WINDOW_EXPIRED, không tạo gì', async () => {
      const order = await seedOrder({
        status: 'COMPLETED',
        statusAt: new Date(Date.now() - 8 * DAY_MS),
      });

      const res = await buyer.post(createUrl(order.orderId)).send(returnReason);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('REFUND_REQUEST_NOT_ALLOWED');
      expect(details(res)).toEqual({ reason: 'WINDOW_EXPIRED' });
      expect(await requestsOf(order.orderId)).toHaveLength(0);
    });

    it.each(['PENDING', 'SHIPPING', 'CANCELLED'] as const)(
      'đơn %s ⇒ 409 NOT_ELIGIBLE_STATUS (chờ xác nhận thì hủy ngay; đang giao không hủy được)',
      async (status) => {
        const order = await seedOrder({ status });

        const res = await buyer
          .post(createUrl(order.orderId))
          .send(cancelReason);

        expect(res.status).toBe(409);
        expect(details(res)).toEqual({ reason: 'NOT_ELIGIBLE_STATUS' });
        expect(await requestsOf(order.orderId)).toHaveLength(0);
      },
    );

    it('đơn online chưa có thanh toán thành công ⇒ 409 PAYMENT_NOT_COLLECTED', async () => {
      const order = await seedOrder({
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
      });

      const res = await buyer.post(createUrl(order.orderId)).send(cancelReason);

      expect(res.status).toBe(409);
      expect(details(res)).toEqual({ reason: 'PAYMENT_NOT_COLLECTED' });
    });

    it('đã có yêu cầu cùng loại ⇒ 409 ALREADY_REQUESTED', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      await buyer.post(createUrl(order.orderId)).send(cancelReason).expect(201);

      const again = await buyer
        .post(createUrl(order.orderId))
        .send(cancelReason);

      expect(again.status).toBe(409);
      expect(details(again)).toEqual({ reason: 'ALREADY_REQUESTED' });
      expect(await requestsOf(order.orderId)).toHaveLength(1);
    });

    it('RACE: 2 lần gửi ĐỒNG THỜI cho cùng đơn (6 vòng) ⇒ đúng 1 thành công, index duy nhất chặn bản còn lại; chỉ 1 yêu cầu + 1 dòng lịch sử', async () => {
      for (let round = 0; round < 6; round++) {
        const order = await seedOrder({ status: 'CONFIRMED' });

        const [r1, r2] = await Promise.all([
          buyer.post(createUrl(order.orderId)).send(cancelReason),
          buyer.post(createUrl(order.orderId)).send(cancelReason),
        ]);

        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        const loser = r1.status === 409 ? r1 : r2;
        expect(details(loser)).toEqual({ reason: 'ALREADY_REQUESTED' });
        const rows = await requestsOf(order.orderId);
        expect(rows).toHaveLength(1);
        expect(rows[0].history).toHaveLength(1);
      }
    });

    it('đơn của người khác / không tồn tại ⇒ 404 (không lộ id); chưa đăng nhập ⇒ 401', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });

      const stranger = await other
        .post(createUrl(order.orderId))
        .send(cancelReason);
      const missing = await buyer
        .post(createUrl('00000000-0000-4000-8000-000000000000'))
        .send(cancelReason);
      const noAuth = await anonymous
        .post(createUrl(order.orderId))
        .send(cancelReason);

      expect(stranger.status).toBe(404);
      expect(code(stranger)).toBe('ORDER_NOT_FOUND');
      expect(missing.status).toBe(404);
      expect(noAuth.status).toBe(401);
      expect(await requestsOf(order.orderId)).toHaveLength(0);
    });

    describe('validate body — báo theo field, không ghi gì', () => {
      let orderId: string;
      beforeAll(async () => {
        orderId = (await seedOrder({ status: 'CONFIRMED' })).orderId;
      });

      it('không gửi body ⇒ 400 theo field reasonCode (không phải "value: Required")', async () => {
        const res = await buyer.post(createUrl(orderId));

        expect(res.status).toBe(400);
        expect(message(res)).toContain(
          'reasonCode: order.validationRefundReasonRequired',
        );
      });

      it('mã lý do lạ ⇒ 400', async () => {
        const res = await buyer
          .post(createUrl(orderId))
          .send({ reasonCode: 'WEIRD' });

        expect(res.status).toBe(400);
        expect(message(res)).toContain('order.validationRefundReasonInvalid');
      });

      it('lý do của yêu cầu TRẢ HÀNG (hàng lỗi) cho đơn xin HỦY ⇒ 400 reasonCode', async () => {
        const res = await buyer
          .post(createUrl(orderId))
          .send({ reasonCode: 'DAMAGED' });

        expect(res.status).toBe(400);
        expect(message(res)).toBe(
          'reasonCode: order.validationRefundReasonInvalid',
        );
      });

      it('chọn OTHER mà không ghi chú ⇒ 400 reasonNote; ghi chú quá 500 ký tự ⇒ 400', async () => {
        const noNote = await buyer
          .post(createUrl(orderId))
          .send({ reasonCode: 'OTHER' });
        const tooLong = await buyer
          .post(createUrl(orderId))
          .send({ reasonCode: 'OTHER', reasonNote: 'x'.repeat(501) });

        expect(noNote.status).toBe(400);
        expect(message(noNote)).toContain(
          'reasonNote: order.validationRefundNoteRequired',
        );
        expect(tooLong.status).toBe(400);
        expect(message(tooLong)).toContain('order.validationRefundNoteTooLong');
        expect(await requestsOf(orderId)).toHaveLength(0);
      });
    });
  });

  describe('POST /refund-requests/:id/withdraw — rút yêu cầu', () => {
    it('seller chưa trả lời ⇒ 200, WITHDRAWN (ghi 2 dòng lịch sử), chi tiết không còn refundRequest và xin lại được; gửi yêu cầu MỚI cho cùng đơn ⇒ 201', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const created = await buyer
        .post(createUrl(order.orderId))
        .send(cancelReason);
      const requestId = orderDetailSchema.parse(data(created)).refundRequest!
        .id;

      const res = await buyer.post(actionUrl(requestId, 'withdraw'));

      expect(res.status).toBe(200);
      const detail = orderDetailSchema.parse(data(res));
      expect(detail.refundRequest).toBeNull();
      expect(detail.canRequestCancel).toBe(true);
      const [row] = await requestsOf(order.orderId);
      expect(row.status).toBe('WITHDRAWN');
      expect(row.history.map((h) => h.toStatus)).toEqual([
        'PENDING_SELLER',
        'WITHDRAWN',
      ]);
      expect(row.history[1]).toMatchObject({
        actorType: 'BUYER',
        actorId: buyerId,
        note: null,
      });

      const again = await buyer
        .post(createUrl(order.orderId))
        .send(cancelReason);
      expect(again.status).toBe(201);
      expect(await requestsOf(order.orderId)).toHaveLength(2);
    });

    it('seller đã trả lời (từ chối) ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION, trạng thái không đổi', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'REJECTED_BY_SELLER',
      });

      const res = await buyer.post(actionUrl(requestId, 'withdraw'));

      expect(res.status).toBe(409);
      expect(code(res)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'REJECTED_BY_SELLER',
      );
    });

    it('rút 2 lần ⇒ lần 2 là 409; rút 2 lần ĐỒNG THỜI ⇒ đúng 1 thành công, chỉ 1 dòng WITHDRAWN', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });

      const [r1, r2] = await Promise.all([
        buyer.post(actionUrl(requestId, 'withdraw')),
        buyer.post(actionUrl(requestId, 'withdraw')),
      ]);

      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const [row] = await requestsOf(order.orderId);
      expect(
        row.history.filter((h) => h.toStatus === 'WITHDRAWN'),
      ).toHaveLength(1);
    });

    it('yêu cầu của người khác / không tồn tại ⇒ 404 REFUND_REQUEST_NOT_FOUND, không đổi gì; chưa đăng nhập ⇒ 401', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });

      const stranger = await other.post(actionUrl(requestId, 'withdraw'));
      const missing = await buyer.post(
        actionUrl('00000000-0000-4000-8000-000000000000', 'withdraw'),
      );
      const noAuth = await anonymous.post(actionUrl(requestId, 'withdraw'));

      expect(stranger.status).toBe(404);
      expect(code(stranger)).toBe('REFUND_REQUEST_NOT_FOUND');
      expect(missing.status).toBe(404);
      expect(noAuth.status).toBe(401);
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'PENDING_SELLER',
      );
    });
  });

  describe('POST /refund-requests/:id/escalate — khiếu nại lên sàn', () => {
    it('seller đã từ chối, còn trong hạn (REFUND_ESCALATE_DAYS = 3) ⇒ 200, ESCALATED; lý do của seller hiện trong timeline, không lộ định danh; hết cờ canEscalate', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'REJECTED_BY_SELLER',
        statusChangedAt: new Date(Date.now() - 1 * DAY_MS),
        sellerNote: 'Hàng đã đóng gói rồi',
      });
      const before = await buyer.get(`/api/v1/orders/${order.orderId}`);
      expect(orderDetailSchema.parse(data(before)).refundRequest).toMatchObject(
        {
          status: 'REJECTED_BY_SELLER',
          canEscalate: true,
          canWithdraw: false,
        },
      );

      const res = await buyer.post(actionUrl(requestId, 'escalate'));

      expect(res.status).toBe(200);
      const detail = orderDetailSchema.parse(data(res));
      expect(detail.refundRequest).toMatchObject({
        status: 'ESCALATED',
        canEscalate: false,
        canWithdraw: false,
      });
      const history = detail.refundRequest!.history;
      expect(history.map((h) => h.toStatus)).toEqual([
        'PENDING_SELLER',
        'REJECTED_BY_SELLER',
        'ESCALATED',
      ]);
      expect(history[1]).toMatchObject({
        actorType: 'SELLER',
        note: 'Hàng đã đóng gói rồi',
      });
      for (const entry of history) expect(entry).not.toHaveProperty('actorId');
      expect(JSON.stringify(res.body)).not.toContain('seller-secret-id');
      const [row] = await requestsOf(order.orderId);
      expect(row.status).toBe('ESCALATED');
      expect(row.history.at(-1)).toMatchObject({
        actorType: 'BUYER',
        actorId: buyerId,
      });
    });

    it('quá hạn khiếu nại (tính từ lúc seller từ chối) ⇒ 409 WINDOW_EXPIRED, trạng thái không đổi, cờ canEscalate đã tắt', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'REJECTED_BY_SELLER',
        statusChangedAt: new Date(Date.now() - 4 * DAY_MS),
      });
      const detail = await buyer.get(`/api/v1/orders/${order.orderId}`);
      expect(
        orderDetailSchema.parse(data(detail)).refundRequest?.canEscalate,
      ).toBe(false);

      const res = await buyer.post(actionUrl(requestId, 'escalate'));

      expect(res.status).toBe(409);
      expect(code(res)).toBe('REFUND_REQUEST_NOT_ALLOWED');
      expect(details(res)).toEqual({ reason: 'WINDOW_EXPIRED' });
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'REJECTED_BY_SELLER',
      );
    });

    it('yêu cầu CHƯA bị từ chối (còn chờ seller) ⇒ 409 REFUND_REQUEST_INVALID_TRANSITION; khiếu nại lần 2 ⇒ 409', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const pending = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });
      const early = await buyer.post(actionUrl(pending, 'escalate'));
      expect(early.status).toBe(409);
      expect(code(early)).toBe('REFUND_REQUEST_INVALID_TRANSITION');

      const order2 = await seedOrder({
        status: 'COMPLETED',
        statusAt: new Date(),
      });
      const rejected = await seedRequest(order2, {
        kind: 'RETURN',
        status: 'REJECTED_BY_SELLER',
        statusChangedAt: new Date(),
      });
      await buyer.post(actionUrl(rejected, 'escalate')).expect(200);
      const second = await buyer.post(actionUrl(rejected, 'escalate'));
      expect(second.status).toBe(409);
      expect(code(second)).toBe('REFUND_REQUEST_INVALID_TRANSITION');
    });

    it('người khác ⇒ 404, không đổi gì', async () => {
      const order = await seedOrder({ status: 'CONFIRMED' });
      const requestId = await seedRequest(order, {
        kind: 'CANCEL',
        status: 'REJECTED_BY_SELLER',
        statusChangedAt: new Date(),
      });

      const res = await other.post(actionUrl(requestId, 'escalate'));

      expect(res.status).toBe(404);
      expect((await requestsOf(order.orderId))[0].status).toBe(
        'REJECTED_BY_SELLER',
      );
    });
  });

  describe('danh sách đơn mang refundRequest / refund', () => {
    it('GET /orders trả yêu cầu mới nhất chưa rút của từng đơn, parse được bằng schema dùng chung; yêu cầu đã rút không hiện', async () => {
      const withRequest = await seedOrder({ status: 'CONFIRMED' });
      await seedRequest(withRequest, {
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
      });
      const withdrawn = await seedOrder({ status: 'CONFIRMED' });
      await seedRequest(withdrawn, { kind: 'CANCEL', status: 'WITHDRAWN' });
      const plain = await seedOrder({ status: 'CONFIRMED' });

      const res = await buyer.get('/api/v1/orders?limit=50');

      expect(res.status).toBe(200);
      const items = orderListResponseSchema.parse(data(res)).items;
      const byId = Object.fromEntries(items.map((o) => [o.id, o]));
      expect(byId[withRequest.orderId].refundRequest).toMatchObject({
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        canWithdraw: true,
      });
      expect(byId[withRequest.orderId].canRequestCancel).toBe(false);
      expect(byId[withdrawn.orderId].refundRequest).toBeNull();
      // Yêu cầu đã rút không chặn xin lại.
      expect(byId[withdrawn.orderId].canRequestCancel).toBe(true);
      expect(byId[plain.orderId].refundRequest).toBeNull();
      expect(byId[plain.orderId].refund).toBeNull();
    });
  });
});
