import { INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type RefundRequestStatus,
  type ShopStatus,
} from '@prisma/client';
import {
  notificationListSchema,
  notificationNewEventSchema,
  REALTIME_EVENTS,
  type NotificationType,
} from '@ecommerce/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../mail/mail-provider.interface';
import { REALTIME_EMITTER } from '../realtime/realtime-emitter';
import {
  addCartItem,
  cleanupByTag,
  createAddress,
  createCheckoutGroup,
  createOrderWithItem,
  createShopWithProduct,
  createVariant,
  seedOrderHistory,
} from '../testing/db-fixtures';
import { createFakeMail } from '../testing/fake-mail';
import { createFakeRealtimeEmitter } from '../testing/fake-realtime-emitter';

// Integration test "LUỒNG THẬT" cho hệ thống thông báo (Week10.md 7.7): chạy các hành động nghiệp vụ qua HTTP thật
// (supertest + Postgres thật + TOÀN BỘ AppModule, NotificationService thật) rồi quan sát HỘP THƯ của từng người qua
// chính API đọc (`GET /notifications`). Chứng minh điều test từng mảnh không chứng minh được: ai thật sự nhận gì sau
// một hành động xuyên module — chủ shop có ORDER_NEW còn người mua thì không, người mua có ORDER_CONFIRMED còn chủ
// shop thì không, mọi Admin đang hoạt động (và chỉ họ) nhận khiếu nại — và người được ĐẨY real-time chính là người
// được GHI vào DB. Bảng "ai nhận gì" của từng loại sự kiện nằm ở notification-events.spec.ts, dữ kiện lấy từ DB ở
// notification.int-spec.ts; ở đây là cả chuỗi từ route tới hộp thư.
//
// Mỗi test tự dựng đơn/yêu cầu bằng Prisma ở đúng trạng thái cần (trừ test đặt hàng đi qua checkout thật) nên không
// phụ thuộc test khác. Danh tính dựng bằng cookie access_token ký trực tiếp (cùng cách e2e real-time): vừa nhanh vừa
// tạo được Admin. Thông báo gửi tới Admin THẬT của DB dev (không mang tiền tố test) cũng được dọn: chỉ xoá những hàng
// sinh ra từ lúc spec này bắt đầu. Chạy: `pnpm test:int`.
const TAG = 'it-notif-flows-';
const SECRET = 'it-notif-flows-access-secret';
const NOTIFICATION_NEW = REALTIME_EVENTS.notificationNew;

const fakeMail = createFakeMail();
const realtime = createFakeRealtimeEmitter();

interface Actor {
  id: string;
  role: 'USER' | 'ADMIN';
}

describe('Luồng thông báo (HTTP thật, NotificationService thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const jwt = new JwtService();
  const startedAt = new Date(Date.now() - 1000);
  const savedEnv = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    PAYMENT_MOCK_ENABLED: process.env.PAYMENT_MOCK_ENABLED,
  };
  let stamp = 0;

  let buyer: Actor;
  let sellerA: Actor;
  let sellerB: Actor;
  let stranger: Actor;
  let admin: Actor;
  let suspendedAdmin: Actor;
  let shopA: string;
  let shopB: string;
  let productA: string;
  let variantA: string;
  let variantB: string;
  let addressId: string;

  // --- dữ liệu -----------------------------------------------------------------------------------------
  const makeUser = async (
    role: 'USER' | 'ADMIN' = 'USER',
    accountStatus: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ): Promise<Actor> =>
    prisma.user.create({
      data: {
        email: `${TAG}${role.toLowerCase()}-${randomUUID()}@test.local`,
        name: `${TAG}${role.toLowerCase()}`,
        role,
        accountStatus,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, role: true },
    });

  const cookieOf = async (actor: Actor) =>
    `access_token=${await jwt.signAsync(
      {
        sub: actor.id,
        role: actor.role,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      { secret: SECRET, algorithm: 'HS256' },
    )}`;

  // --- HTTP --------------------------------------------------------------------------------------------
  const call = async (
    actor: Actor,
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', await cookieOf(actor));
    return body ? req.send(body) : req;
  };
  const dataOf = (res: { body: unknown }) =>
    (res.body as { data: unknown }).data;

  // Hộp thư của một người, cũ → mới, qua CHÍNH API đọc (đồng thời kiểm response parse được bằng schema FE sẽ dùng).
  const inboxOf = async (actor: Actor) => {
    const res = await call(actor, 'get', '/notifications?limit=50');
    expect(res.status).toBe(200);
    return notificationListSchema.parse(dataOf(res)).items.reverse();
  };
  const typesOf = async (actor: Actor): Promise<NotificationType[]> =>
    (await inboxOf(actor)).map((item) => item.type as NotificationType);

  // Ảnh chụp hộp thư của cả nhóm nhân vật — assert MỘT lần cho "ai nhận gì, ai không".
  const snapshot = async () => ({
    buyer: await typesOf(buyer),
    sellerA: await typesOf(sellerA),
    sellerB: await typesOf(sellerB),
    stranger: await typesOf(stranger),
  });
  const NOBODY = { buyer: [], sellerA: [], sellerB: [], stranger: [] };

  // Thông báo của MỌI Admin đang hoạt động theo loại (kể cả Admin thật của DB dev), từ lúc spec bắt đầu.
  const adminRows = (type: NotificationType) =>
    prisma.notification.findMany({
      where: {
        type,
        createdAt: { gte: startedAt },
        user: { role: 'ADMIN' },
      },
      select: { userId: true, data: true },
    });
  // Admin bị khoá không đọc được hộp thư qua API (401 ACCOUNT_NOT_ACTIVE) nên đếm thẳng trong DB.
  const storedCountOf = (actor: Actor) =>
    prisma.notification.count({ where: { userId: actor.id } });
  const activeAdminIds = async () =>
    (
      await prisma.user.findMany({
        where: { role: 'ADMIN', accountStatus: 'ACTIVE' },
        select: { id: true },
      })
    ).map((u) => u.id);

  // Đơn của buyer ở `status`, thanh toán COD (đúng lịch sử trạng thái của luồng thật).
  async function seedOrder(
    status: OrderStatus,
    target: { shopId: string; variantId: string } = {
      shopId: shopA,
      variantId: variantA,
    },
  ) {
    const group = await createCheckoutGroup(prisma, buyer.id);
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        shopId: target.shopId,
        checkoutGroupId: group.id,
        status,
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
              productVariantId: target.variantId,
              quantity: 2,
              priceAtPurchase: 100_000,
              productName: `${TAG}sp`,
              sku: `SKU-${Date.now()}-${++stamp}`,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: {
          create: seedOrderHistory(status, { isCod: true }),
        },
      },
      select: { id: true },
    });
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: 'COD',
        status: 'PENDING',
        amount: 220_000,
        txnRef: `${TAG.toUpperCase()}${Date.now()}${++stamp}`,
        expiresAt: null,
      },
    });
    return order.id;
  }

  // Yêu cầu hủy/trả ở trạng thái bất kỳ, kèm dòng thời gian khớp trạng thái.
  async function seedRefundRequest(
    orderId: string,
    status: RefundRequestStatus,
  ) {
    const created = await prisma.refundRequest.create({
      data: {
        orderId,
        userId: buyer.id,
        shopId: shopA,
        kind: 'CANCEL',
        reasonCode: 'CHANGE_OF_MIND',
        sellerRespondBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status,
        statusChangedAt: new Date(Date.now() - 60_000),
        history: {
          create: [{ fromStatus: null, toStatus: status, actorType: 'BUYER' }],
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  // --- vòng đời ----------------------------------------------------------------------------------------
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    await cleanupByTag(prisma, TAG);

    const a = await createShopWithProduct(prisma, TAG);
    const b = await createShopWithProduct(prisma, TAG);
    shopA = a.shopId;
    shopB = b.shopId;
    productA = a.productId;
    variantA = (await createVariant(prisma, a, { stock: 500 })).id;
    variantB = (await createVariant(prisma, b, { stock: 500 })).id;
    sellerA = { id: a.ownerId, role: 'USER' };
    sellerB = { id: b.ownerId, role: 'USER' };
    buyer = await makeUser();
    stranger = await makeUser();
    admin = await makeUser('ADMIN');
    suspendedAdmin = await makeUser('ADMIN', 'SUSPENDED');
    addressId = (await createAddress(prisma, buyer.id)).id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .overrideProvider(REALTIME_EMITTER)
      .useValue(realtime)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    // listen(0) MỘT lần (rules/backend.md mục 7): supertest không tự đóng server giữa các request song song.
    await app.listen(0);
  });

  beforeEach(async () => {
    realtime.reset();
    fakeMail.reset();
    // Sạch hộp thư của nhân vật test và của Admin thật sinh ra từ lúc spec bắt đầu, để mỗi test đo từ 0.
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { user: { email: { startsWith: TAG } } },
          { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
        ],
      },
    });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await app.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // Ai được ĐẨY `notification:new`, theo id người nhận.
  const pushedTo = () =>
    realtime.emitted
      .filter((e) => e.event === NOTIFICATION_NEW)
      .map((e) => e.userId)
      .sort();

  // -------------------------------------------------------------------------------------------------------
  describe('đặt hàng', () => {
    it('đặt COD hai shop bằng checkout thật ⇒ mỗi chủ shop có ĐÚNG một ORDER_NEW cho đơn của mình, người mua và người ngoài không có gì', async () => {
      await addCartItem(prisma, buyer.id, variantA, 1);
      await addCartItem(prisma, buyer.id, variantB, 1);
      const preview = await call(buyer, 'post', '/checkout/preview', {
        addressId,
      });
      const grandTotal = Number(
        (dataOf(preview) as { grandTotal: string }).grandTotal,
      );

      const res = await call(buyer, 'post', '/checkout', {
        addressId,
        paymentMethod: 'COD',
        expectedTotal: grandTotal,
      });

      expect(res.status).toBe(201);
      const { checkoutGroupId } = dataOf(res) as { checkoutGroupId: string };
      const orders = await prisma.order.findMany({
        where: { checkoutGroupId },
        select: { id: true, shopId: true },
      });
      expect(orders).toHaveLength(2);
      const orderOf = (shopId: string) =>
        orders.find((o) => o.shopId === shopId)!.id;
      const inboxA = await inboxOf(sellerA);
      const inboxB = await inboxOf(sellerB);
      expect(inboxA.map((n) => n.type)).toEqual(['ORDER_NEW']);
      expect(inboxB.map((n) => n.type)).toEqual(['ORDER_NEW']);
      expect(inboxA[0].data).toMatchObject({ orderId: orderOf(shopA) });
      expect(inboxB[0].data).toMatchObject({ orderId: orderOf(shopB) });
      expect(await typesOf(buyer)).toEqual([]);
      expect(await typesOf(stranger)).toEqual([]);
      // Huy hiệu chưa đọc khớp hộp thư.
      const count = await call(sellerA, 'get', '/notifications/unread-count');
      expect(dataOf(count)).toEqual({ unreadCount: 1 });
    });

    it('người được ĐẨY real-time chính là người được GHI: mỗi chủ shop một gói notification:new mang đúng id của hàng đã lưu', async () => {
      await addCartItem(prisma, buyer.id, variantA, 1);
      await addCartItem(prisma, buyer.id, variantB, 1);
      const preview = await call(buyer, 'post', '/checkout/preview', {
        addressId,
      });
      await call(buyer, 'post', '/checkout', {
        addressId,
        paymentMethod: 'COD',
        expectedTotal: Number(
          (dataOf(preview) as { grandTotal: string }).grandTotal,
        ),
      }).then((res) => expect(res.status).toBe(201));

      expect(pushedTo()).toEqual([sellerA.id, sellerB.id].sort());
      for (const owner of [sellerA, sellerB]) {
        const [row] = await inboxOf(owner);
        const pushed = realtime.emitted.find((e) => e.userId === owner.id);
        const parsed = notificationNewEventSchema.parse(pushed?.payload);
        expect(parsed.id).toBe(row.id);
        expect(parsed.readAt).toBeNull();
      }
    });

    // Đặt hai shop bằng VNPAY (mock): đơn ở AWAITING_PAYMENT, chưa ai được báo.
    async function placeOnlineOrders() {
      await addCartItem(prisma, buyer.id, variantA, 1);
      await addCartItem(prisma, buyer.id, variantB, 1);
      const preview = await call(buyer, 'post', '/checkout/preview', {
        addressId,
      });
      const res = await call(buyer, 'post', '/checkout', {
        addressId,
        paymentMethod: 'VNPAY',
        expectedTotal: Number(
          (dataOf(preview) as { grandTotal: string }).grandTotal,
        ),
      });
      expect(res.status).toBe(201);
      const { checkoutGroupId, paymentUrl } = dataOf(res) as {
        checkoutGroupId: string;
        paymentUrl: string;
      };
      return { checkoutGroupId, paymentUrl };
    }

    it('đặt đơn ONLINE (VNPAY) rồi thanh toán thành công ⇒ chỉ SAU khi thanh toán mỗi chủ shop mới có ORDER_NEW; người mua không', async () => {
      const { paymentUrl } = await placeOnlineOrders();
      // Chưa thanh toán: đơn chưa vào PENDING nên shop chưa thấy, chưa ai được báo.
      expect(await snapshot()).toEqual(NOBODY);

      // Đi ĐÚNG payUrl do BE ký (cùng cách checkout.e2e-spec), chọn kết quả SUCCESS.
      const url = new URL(paymentUrl);
      await request(app.getHttpServer())
        .get(`${url.pathname}${url.search}&outcome=SUCCESS`)
        .expect(302);

      expect(await snapshot()).toEqual({
        ...NOBODY,
        sellerA: ['ORDER_NEW'],
        sellerB: ['ORDER_NEW'],
      });
      expect(pushedTo()).toEqual([sellerA.id, sellerB.id].sort());
    });

    it('đặt đơn ONLINE rồi người mua hủy nhóm khi CHƯA thanh toán ⇒ CHỈ người mua có ORDER_CANCELLED; chủ shop không bao giờ biết có đơn', async () => {
      const { checkoutGroupId } = await placeOnlineOrders();

      const res = await call(
        buyer,
        'post',
        `/checkout/groups/${checkoutGroupId}/cancel`,
      );

      expect(res.status).toBe(200);
      const snap = await snapshot();
      expect(snap.buyer).toEqual(['ORDER_CANCELLED', 'ORDER_CANCELLED']);
      expect(snap.sellerA).toEqual([]);
      expect(snap.sellerB).toEqual([]);
      expect(snap.stranger).toEqual([]);
      expect(pushedTo()).toEqual([buyer.id, buyer.id]);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('xử lý đơn', () => {
    it('chủ shop xác nhận ⇒ NGƯỜI MUA có ORDER_CONFIRMED; chủ shop, shop khác và người ngoài không có gì', async () => {
      const orderId = await seedOrder('PENDING');

      const res = await call(
        sellerA,
        'post',
        `/shops/${shopA}/orders/${orderId}/confirm`,
      );

      expect(res.status).toBe(200);
      const snap = await snapshot();
      expect(snap).toEqual({ ...NOBODY, buyer: ['ORDER_CONFIRMED'] });
      expect((await inboxOf(buyer))[0].data).toMatchObject({ orderId });
      expect(pushedTo()).toEqual([buyer.id]);
    });

    it('chủ shop từ chối đơn ⇒ người mua có ORDER_CANCELLED, chủ shop không tự nhận thông báo về việc mình vừa làm', async () => {
      const orderId = await seedOrder('PENDING');

      const res = await call(
        sellerA,
        'post',
        `/shops/${shopA}/orders/${orderId}/reject`,
        { reason: 'Hết hàng' },
      );

      expect(res.status).toBe(200);
      expect(await snapshot()).toEqual({
        ...NOBODY,
        buyer: ['ORDER_CANCELLED'],
      });
    });

    it('người mua hủy đơn ⇒ CHỦ SHOP được báo (vai người bán), người mua có bản ghi riêng (vai người mua); shop khác và người ngoài không có gì', async () => {
      const orderId = await seedOrder('PENDING');

      const res = await call(buyer, 'post', `/orders/${orderId}/cancel`);

      expect(res.status).toBe(200);
      expect(await snapshot()).toEqual({
        ...NOBODY,
        buyer: ['ORDER_CANCELLED'],
        sellerA: ['ORDER_CANCELLED'],
      });
      // Cùng loại nhưng KHÁC vai: nội dung hiển thị và đường dẫn ở FE suy từ `audience`.
      expect((await inboxOf(sellerA))[0].data).toMatchObject({
        orderId,
        audience: 'SELLER',
        by: 'BUYER',
      });
      expect((await inboxOf(buyer))[0].data).toMatchObject({
        orderId,
        audience: 'BUYER',
        by: 'BUYER',
      });
    });

    it('người mua tự xác nhận đã nhận ⇒ không ai được báo (người mua vừa tự làm, ORDER_COMPLETED chỉ dành cho đơn TỰ hoàn tất)', async () => {
      const orderId = await seedOrder('SHIPPING');

      const res = await call(
        buyer,
        'post',
        `/orders/${orderId}/confirm-received`,
      );

      expect(res.status).toBe(200);
      expect(await snapshot()).toEqual(NOBODY);
      expect(pushedTo()).toEqual([]);
    });

    it('đẩy real-time LỖI không làm hỏng hành động: vẫn 200 và thông báo đã nằm trong hộp thư của người mua', async () => {
      const orderId = await seedOrder('PENDING');
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      realtime.failWith();

      const res = await call(
        sellerA,
        'post',
        `/shops/${shopA}/orders/${orderId}/confirm`,
      );

      expect(res.status).toBe(200);
      // Lỗi đẩy THẬT SỰ đã xảy ra (và được log), không phải test xanh vì đường đẩy không chạy.
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('Pushing notification'),
      );
      expect(await typesOf(buyer)).toEqual(['ORDER_CONFIRMED']);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
          .status,
      ).toBe('CONFIRMED');
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('yêu cầu hủy / khiếu nại', () => {
    it('người mua gửi yêu cầu hủy ⇒ CHỦ SHOP có REFUND_REQUEST_NEW (không phải người mua, không phải Admin)', async () => {
      const orderId = await seedOrder('CONFIRMED');

      const res = await call(
        buyer,
        'post',
        `/orders/${orderId}/refund-requests`,
        {
          reasonCode: 'CHANGE_OF_MIND',
        },
      );

      expect(res.status).toBe(201);
      expect(await snapshot()).toEqual({
        ...NOBODY,
        sellerA: ['REFUND_REQUEST_NEW'],
      });
      expect(await adminRows('REFUND_REQUEST_NEW')).toEqual([]);
    });

    it('chủ shop từ chối yêu cầu ⇒ người mua có REFUND_REQUEST_REJECTED kèm lý do; người mua khiếu nại ⇒ MỌI Admin đang hoạt động (và chỉ họ) + chủ shop nhận REFUND_REQUEST_ESCALATED', async () => {
      const orderId = await seedOrder('CONFIRMED');
      const requestId = await seedRefundRequest(orderId, 'PENDING_SELLER');

      const reject = await call(
        sellerA,
        'post',
        `/shops/${shopA}/refund-requests/${requestId}/reject`,
        { note: 'Đơn đã đóng gói' },
      );
      expect(reject.status).toBe(200);
      expect(await snapshot()).toEqual({
        ...NOBODY,
        buyer: ['REFUND_REQUEST_REJECTED'],
      });
      expect((await inboxOf(buyer))[0].data).toMatchObject({
        orderId,
        reason: 'Đơn đã đóng gói',
      });

      const escalate = await call(
        buyer,
        'post',
        `/refund-requests/${requestId}/escalate`,
      );
      expect(escalate.status).toBe(200);

      const rows = await adminRows('REFUND_REQUEST_ESCALATED');
      expect(rows.map((r) => r.userId).sort()).toEqual(
        [...(await activeAdminIds())].sort(),
      );
      expect(rows.map((r) => r.userId)).toContain(admin.id);
      expect(rows.map((r) => r.userId)).not.toContain(suspendedAdmin.id);
      expect(
        rows.every(
          (r) => (r.data as { audience: string }).audience === 'ADMIN',
        ),
      ).toBe(true);
      // Chủ shop cũng được báo (với vai người bán); người mua tự khiếu nại và người ngoài thì không.
      const snap = await snapshot();
      expect(snap.sellerA).toEqual(['REFUND_REQUEST_ESCALATED']);
      expect(snap.buyer).toEqual(['REFUND_REQUEST_REJECTED']);
      expect(snap.sellerB).toEqual([]);
      expect(snap.stranger).toEqual([]);
      expect(await storedCountOf(suspendedAdmin)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('đánh giá', () => {
    it('người mua đánh giá ⇒ CHỦ SHOP có REVIEW_NEW; chủ shop trả lời ⇒ NGƯỜI MUA có REVIEW_REPLIED; sửa lại câu trả lời thì không báo lần nữa', async () => {
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyer.id,
        shopId: shopA,
        variantId: variantA,
      });

      const created = await call(buyer, 'post', '/reviews', {
        orderId,
        productId: productA,
        rating: 5,
        comment: 'Giao nhanh, đúng mô tả',
      });
      expect(created.status).toBe(201);
      expect(await snapshot()).toEqual({ ...NOBODY, sellerA: ['REVIEW_NEW'] });

      const reviewId = (dataOf(created) as { id: string }).id;
      const first = await call(
        sellerA,
        'put',
        `/shops/${shopA}/reviews/${reviewId}/reply`,
        { reply: 'Cảm ơn bạn đã ủng hộ' },
      );
      expect(first.status).toBe(200);
      expect(await snapshot()).toEqual({
        ...NOBODY,
        sellerA: ['REVIEW_NEW'],
        buyer: ['REVIEW_REPLIED'],
      });

      const edited = await call(
        sellerA,
        'put',
        `/shops/${shopA}/reviews/${reviewId}/reply`,
        { reply: 'Cảm ơn bạn rất nhiều' },
      );
      expect(edited.status).toBe(200);
      expect(await typesOf(buyer)).toEqual(['REVIEW_REPLIED']);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('shop', () => {
    async function shopWithStatus(status: ShopStatus) {
      const owner = await makeUser();
      const shop = await prisma.shop.create({
        data: {
          ownerId: owner.id,
          name: `${TAG}shop-${status}`,
          slug: `${TAG}shop-${status.toLowerCase()}-${Date.now()}-${++stamp}`,
          status,
        },
        select: { id: true },
      });
      return { owner, shopId: shop.id };
    }

    it('Admin từ chối shop ⇒ CHỦ SHOP có SHOP_STATUS_CHANGED kèm trạng thái mới; Admin không tự nhận thông báo về việc mình vừa làm', async () => {
      const { owner, shopId } = await shopWithStatus('PENDING');

      const res = await call(admin, 'patch', `/admin/shops/${shopId}/status`, {
        status: 'REJECTED',
        reason: 'Thiếu giấy phép kinh doanh',
      });

      expect(res.status).toBe(200);
      const inbox = await inboxOf(owner);
      expect(inbox.map((n) => n.type)).toEqual(['SHOP_STATUS_CHANGED']);
      expect(inbox[0].data).toMatchObject({ shopId, status: 'REJECTED' });
      expect(await typesOf(admin)).toEqual([]);
      expect(pushedTo()).toEqual([owner.id]);
    });

    it('chủ shop nộp lại sau khi bị từ chối ⇒ MỌI Admin đang hoạt động (và chỉ họ) có ADMIN_SHOP_PENDING; chủ shop không', async () => {
      const { owner, shopId } = await shopWithStatus('REJECTED');

      const res = await call(owner, 'post', `/shops/${shopId}/resubmit`, {});

      expect(res.status).toBe(200);
      const rows = await adminRows('ADMIN_SHOP_PENDING');
      expect(rows.map((r) => r.userId).sort()).toEqual(
        [...(await activeAdminIds())].sort(),
      );
      expect(rows.map((r) => r.userId)).toContain(admin.id);
      expect(rows.map((r) => r.userId)).not.toContain(suspendedAdmin.id);
      expect(await typesOf(owner)).toEqual([]);
      expect(await storedCountOf(suspendedAdmin)).toBe(0);
      expect(await typesOf(stranger)).toEqual([]);
    });

    it('Admin duyệt shop ⇒ chủ shop có SHOP_STATUS_CHANGED (APPROVED)', async () => {
      const { owner, shopId } = await shopWithStatus('PENDING');

      const res = await call(admin, 'patch', `/admin/shops/${shopId}/status`, {
        status: 'APPROVED',
      });

      expect(res.status).toBe(200);
      const inbox = await inboxOf(owner);
      expect(inbox.map((n) => n.type)).toEqual(['SHOP_STATUS_CHANGED']);
      expect(inbox[0].data).toMatchObject({ status: 'APPROVED' });
    });
  });
});
