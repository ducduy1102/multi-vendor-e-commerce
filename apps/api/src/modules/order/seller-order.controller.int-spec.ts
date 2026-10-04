import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ShopStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  sellerOrderDetailSchema,
  sellerOrderListResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { createFakeMail } from '../../shared/testing/fake-mail';

import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho GET /shops/:shopId/orders[/:orderId]
// (Week8.md 2.5). Chứng minh điều unit test với mock không chứng minh được: đơn AWAITING_PAYMENT
// TUYỆT ĐỐI không lộ cho Seller (cả danh sách lẫn chi tiết), Seller không đọc được đơn của shop khác,
// response không chứa định danh của buyer, và shop bị khoá vẫn đọc được đơn đã có.
// Chạy: `pnpm test:int`.
const TAG = 'it-seller-orders-';

interface SeedOrder {
  buyerId: string;
  shopId: string;
  status: OrderStatus;
  createdAt?: Date;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  expiresAt?: Date | null;
  buyerNote?: string | null;
}

const fakeMail = createFakeMail();

describe('SellerOrderController (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const newAgent = () => request.agent(app.getHttpServer());
  let sellerA: ReturnType<typeof newAgent>;
  let sellerB: ReturnType<typeof newAgent>;
  let sellerASuspended: ReturnType<typeof newAgent>;
  let buyerId: string;
  let buyerEmail: string;
  let shopA: string;
  let shopB: string;
  let shopSuspended: string;

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
    return { agent, userId: user.id, email };
  }

  async function createShopFor(
    ownerId: string,
    suffix: string,
    status: ShopStatus,
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

  async function seedOrder(input: SeedOrder) {
    const group = await createCheckoutGroup(prisma, input.buyerId);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 100 });

    const order = await prisma.order.create({
      data: {
        userId: input.buyerId,
        shopId: input.shopId,
        checkoutGroupId: group.id,
        status: input.status,
        createdAt: input.createdAt,
        totalAmount: 220_000,
        shippingFee: 20_000,
        buyerNote: input.buyerNote,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [1, 2].map((n) => ({
            productVariantId: variant.id,
            quantity: 1,
            priceAtPurchase: 100_000,
            productName: `${TAG}sp-${n}`,
            sku: `SKU-${stamp}-${n}`,
            variantLabel: null,
            imageUrl: null,
          })),
        },
        statusHistory: {
          create: [
            {
              fromStatus: null,
              toStatus: 'AWAITING_PAYMENT',
              actorType: 'BUYER',
              actorId: input.buyerId,
              createdAt: new Date('2026-10-01T10:00:00.000Z'),
            },
          ],
        },
      },
      select: { id: true },
    });

    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: input.paymentMethod ?? 'VNPAY',
        status: input.paymentStatus ?? 'SUCCESS',
        amount: 220_000,
        txnRef: `${TAG.toUpperCase()}${stamp}${order.id.slice(0, 8)}`,
        expiresAt:
          input.expiresAt === undefined
            ? new Date(Date.now() + 15 * 60_000)
            : input.expiresAt,
      },
    });
    return order.id;
  }

  const body = (res: { body: unknown }) => (res.body as { data: unknown }).data;

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    // MailProvider GIẢ: không bao giờ gọi Resend thật (đăng ký tài khoản và các hành động đơn hàng đều
    // gửi email), và cho phép assert email đã gửi (Week8.md 2.8).
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
    const buyer = await registerAndLogin('buyer');
    sellerA = a.agent;
    sellerB = b.agent;
    sellerASuspended = s.agent;
    buyerId = buyer.userId;
    buyerEmail = buyer.email;
    shopA = await createShopFor(a.userId, 'a', 'APPROVED');
    shopB = await createShopFor(b.userId, 'b', 'APPROVED');
    shopSuspended = await createShopFor(s.userId, 's', 'SUSPENDED');
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  it('chưa đăng nhập — 401', async () => {
    const anonymous = request(app.getHttpServer());
    await anonymous.get(`/api/v1/shops/${shopA}/orders`).expect(401);
    await anonymous.get(`/api/v1/shops/${shopA}/orders/any`).expect(401);
  });

  describe('đọc đơn của shop', () => {
    let unpaid: string;
    let pendingOnline: string;
    let pendingCod: string;
    let confirmed: string;
    let packed: string;
    let shipping: string;
    let completed: string;
    let cancelled: string;
    let otherShopOrder: string;

    beforeAll(async () => {
      const t = (minutes: number) =>
        new Date(Date.parse('2026-10-01T09:00:00.000Z') + minutes * 60_000);
      const seed = (status: OrderStatus, minutes: number, extra = {}) =>
        seedOrder({
          buyerId,
          shopId: shopA,
          status,
          createdAt: t(minutes),
          ...extra,
        });

      unpaid = await seed('AWAITING_PAYMENT', 1, {
        paymentStatus: 'PENDING',
      });
      pendingOnline = await seed('PENDING', 2);
      pendingCod = await seed('PENDING', 3, {
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        expiresAt: null,
      });
      confirmed = await seed('CONFIRMED', 4);
      packed = await seed('PACKED', 5);
      shipping = await seed('SHIPPING', 6);
      completed = await seed('COMPLETED', 7);
      cancelled = await seed('CANCELLED', 8);
      otherShopOrder = await seedOrder({
        buyerId,
        shopId: shopB,
        status: 'PENDING',
        createdAt: t(9),
      });
    });

    describe('quyền truy cập shop', () => {
      it('seller KHÔNG đọc được đơn của shop không thuộc mình — 403', async () => {
        await sellerB.get(`/api/v1/shops/${shopA}/orders`).expect(403);
        await sellerB
          .get(`/api/v1/shops/${shopA}/orders/${pendingOnline}`)
          .expect(403);
      });

      it('buyer thường (không có shop) cũng không đọc được — 403', async () => {
        const buyerAgent = newAgent();
        await buyerAgent
          .post('/api/v1/auth/login')
          .send({ email: buyerEmail, password: 'password123' })
          .expect(200);
        await buyerAgent.get(`/api/v1/shops/${shopA}/orders`).expect(403);
      });

      it('shop không tồn tại — 404', async () => {
        await sellerA.get('/api/v1/shops/khong-ton-tai/orders').expect(404);
      });
    });

    describe('danh sách', () => {
      it('chỉ trả đơn của shop mình, mới nhất trước, TUYỆT ĐỐI không có đơn AWAITING_PAYMENT', async () => {
        const res = await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`);

        expect(res.status).toBe(200);
        const data = sellerOrderListResponseSchema.parse(body(res));
        expect(data.items.map((o) => o.id)).toEqual([
          cancelled,
          completed,
          shipping,
          packed,
          confirmed,
          pendingCod,
          pendingOnline,
        ]);
        expect(data.total).toBe(7);
        const ids = data.items.map((o) => o.id);
        expect(ids).not.toContain(unpaid);
        expect(ids).not.toContain(otherShopOrder);
        expect(data.items.map((o) => o.status)).not.toContain(
          'AWAITING_PAYMENT',
        );
      });

      it('KHÔNG lộ định danh buyer (userId/email) ở bất kỳ đâu trong response', async () => {
        const raw = JSON.stringify(
          (await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`)).body,
        );

        expect(raw).not.toContain(buyerId);
        expect(raw).not.toContain(buyerEmail);
        expect(raw).not.toContain('"userId"');
      });

      it.each([
        ['pending', ['pendingCod', 'pendingOnline']],
        ['processing', ['packed', 'confirmed']],
        ['shipping', ['shipping']],
        ['completed', ['completed']],
        ['cancelled', ['cancelled']],
      ])('tab=%s lọc đúng nhóm trạng thái', async (tab, keys) => {
        const ids: Record<string, string> = {
          pendingOnline,
          pendingCod,
          confirmed,
          packed,
          shipping,
          completed,
          cancelled,
        };
        const res = await sellerA.get(
          `/api/v1/shops/${shopA}/orders?tab=${tab}`,
        );

        expect(res.status).toBe(200);
        const data = sellerOrderListResponseSchema.parse(body(res));
        expect(data.items.map((o) => o.id)).toEqual(keys.map((k) => ids[k]));
        expect(data.total).toBe(keys.length);
      });

      it.each([
        '?tab=awaiting-payment',
        '?tab=refunded',
        '?limit=51',
        '?page=0',
      ])(
        'query sai %s — 400 (không thể xin đơn chưa thanh toán)',
        async (q) => {
          const res = await sellerA.get(`/api/v1/shops/${shopA}/orders${q}`);
          expect(res.status).toBe(400);
        },
      );

      it('phân trang: total là tổng thật, không trùng đơn giữa các trang', async () => {
        const p1 = sellerOrderListResponseSchema.parse(
          body(
            await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=4&page=1`),
          ),
        );
        const p2 = sellerOrderListResponseSchema.parse(
          body(
            await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=4&page=2`),
          ),
        );

        expect(p1.total).toBe(7);
        expect(p1.items).toHaveLength(4);
        expect(p2.items).toHaveLength(3);
        const all = [...p1.items, ...p2.items].map((o) => o.id);
        expect(new Set(all).size).toBe(7);
      });

      it('cờ hành động đúng: COD chờ xác nhận được từ chối, đơn trả online thì không', async () => {
        const data = sellerOrderListResponseSchema.parse(
          body(await sellerA.get(`/api/v1/shops/${shopA}/orders?limit=50`)),
        );
        const byId = Object.fromEntries(data.items.map((o) => [o.id, o]));

        expect(byId[pendingCod]).toMatchObject({
          paymentMethod: 'COD',
          canConfirm: true,
          canReject: true,
        });
        expect(byId[pendingOnline]).toMatchObject({
          paymentMethod: 'VNPAY',
          canConfirm: true,
          canReject: false,
        });
        expect(byId[confirmed]).toMatchObject({
          canPack: true,
          canConfirm: false,
        });
        expect(byId[packed]).toMatchObject({ canShip: true, canPack: false });
        expect(byId[shipping]).toMatchObject({
          canConfirm: false,
          canPack: false,
          canShip: false,
          canReject: false,
        });
      });
    });

    describe('chi tiết', () => {
      it('đơn của shop mình — 200, parse được bằng schema dùng chung, có người nhận + timeline', async () => {
        const res = await sellerA.get(
          `/api/v1/shops/${shopA}/orders/${pendingCod}`,
        );

        expect(res.status).toBe(200);
        const order = sellerOrderDetailSchema.parse(body(res));
        expect(order.recipientName).toBe('Nguyễn Văn A');
        expect(order.recipientPhone).toBe('0912345678');
        expect(order.shippingAddressLine).toBe('12 Nguyễn Huệ');
        expect(order.items).toHaveLength(2);
        expect(order.subtotal).toBe('200000');
        expect(order.history[0].fromStatus).toBeNull();
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain(buyerId);
        expect(raw).not.toContain(buyerEmail);
        expect(raw).not.toContain('actorId');
      });

      it('đơn AWAITING_PAYMENT của CHÍNH shop mình — 404 (đơn chưa thanh toán không lộ cho Seller)', async () => {
        const res = await sellerA.get(
          `/api/v1/shops/${shopA}/orders/${unpaid}`,
        );
        expect(res.status).toBe(404);
        expect((res.body as { code: string }).code).toBe('ORDER_NOT_FOUND');
      });

      it('đơn của shop khác (id có thật) và đơn không tồn tại — cùng 1 body 404, không lộ id có thật', async () => {
        const other = await sellerA.get(
          `/api/v1/shops/${shopA}/orders/${otherShopOrder}`,
        );
        const missing = await sellerA.get(
          `/api/v1/shops/${shopA}/orders/khong-ton-tai`,
        );
        const unpaidRes = await sellerA.get(
          `/api/v1/shops/${shopA}/orders/${unpaid}`,
        );

        expect(other.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(other.body).toEqual(missing.body);
        expect(unpaidRes.body).toEqual(missing.body);
      });
    });
  });

  describe('shop bị khoá (SUSPENDED)', () => {
    it('vẫn đọc được đơn đã có để xử lý tiếp (Week8.md 1.8 — chỉ chặn đơn mới)', async () => {
      const orderId = await seedOrder({
        buyerId,
        shopId: shopSuspended,
        status: 'CONFIRMED',
      });

      const list = await sellerASuspended.get(
        `/api/v1/shops/${shopSuspended}/orders`,
      );
      const detail = await sellerASuspended.get(
        `/api/v1/shops/${shopSuspended}/orders/${orderId}`,
      );

      expect(list.status).toBe(200);
      expect(sellerOrderListResponseSchema.parse(body(list)).total).toBe(1);
      expect(detail.status).toBe(200);
    });
  });

  // Lời nhắn của người mua theo từng shop (Week8.md 3B): cùng 1 buyer đặt ở 2 shop với 2 lời nhắn
  // khác nhau — mỗi seller chỉ được thấy lời nhắn của ĐƠN CỦA SHOP MÌNH. Dùng 2 seller/shop riêng để
  // không đổi số đếm của các test danh sách ở trên.
  describe('buyerNote — mỗi seller chỉ thấy lời nhắn của đơn mình (Week8.md 3B)', () => {
    const NOTE_C = 'Giao giờ hành chính, gọi trước khi giao';
    const NOTE_D = 'Gói quà giúp mình, đừng ghi giá';
    const HTML_NOTE = '<img src=x onerror=alert(1)> & "quote"';
    let sellerC: ReturnType<typeof newAgent>;
    let sellerD: ReturnType<typeof newAgent>;
    let shopC: string;
    let shopD: string;
    let orderC: string;
    let orderD: string;
    let orderCNoNote: string;
    let orderCHtml: string;

    beforeAll(async () => {
      const c = await registerAndLogin('c');
      const d = await registerAndLogin('d');
      sellerC = c.agent;
      sellerD = d.agent;
      shopC = await createShopFor(c.userId, 'c', 'APPROVED');
      shopD = await createShopFor(d.userId, 'd', 'APPROVED');
      const t = (minutes: number) =>
        new Date(Date.parse('2026-10-02T09:00:00.000Z') + minutes * 60_000);
      orderC = await seedOrder({
        buyerId,
        shopId: shopC,
        status: 'PENDING',
        createdAt: t(1),
        buyerNote: NOTE_C,
      });
      orderD = await seedOrder({
        buyerId,
        shopId: shopD,
        status: 'PENDING',
        createdAt: t(1),
        buyerNote: NOTE_D,
      });
      orderCNoNote = await seedOrder({
        buyerId,
        shopId: shopC,
        status: 'PENDING',
        createdAt: t(2),
      });
      orderCHtml = await seedOrder({
        buyerId,
        shopId: shopC,
        status: 'CONFIRMED',
        createdAt: t(3),
        buyerNote: HTML_NOTE,
      });
    });

    it('danh sách: seller C thấy lời nhắn của đơn mình, null khi không có, và KHÔNG chứa lời nhắn gửi shop D ở bất kỳ đâu', async () => {
      const res = await sellerC.get(`/api/v1/shops/${shopC}/orders?limit=50`);

      expect(res.status).toBe(200);
      const data = sellerOrderListResponseSchema.parse(body(res));
      const noteById = Object.fromEntries(
        data.items.map((o) => [o.id, o.buyerNote]),
      );
      expect(noteById).toEqual({
        [orderC]: NOTE_C,
        [orderCNoNote]: null,
        [orderCHtml]: HTML_NOTE,
      });
      expect(JSON.stringify(res.body)).not.toContain(NOTE_D);
    });

    it('chi tiết: mỗi seller đọc lời nhắn của đơn mình; đọc đơn của shop kia thì 403/404 và không rò lời nhắn', async () => {
      const own = await sellerC.get(`/api/v1/shops/${shopC}/orders/${orderC}`);
      expect(own.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(body(own)).buyerNote).toBe(NOTE_C);

      const ownD = await sellerD.get(`/api/v1/shops/${shopD}/orders/${orderD}`);
      expect(sellerOrderDetailSchema.parse(body(ownD)).buyerNote).toBe(NOTE_D);

      // Đơn của D qua đường của C (shopId của C) và qua shopId của D (không phải chủ) — đều không có nội dung.
      const viaOwnShop = await sellerC.get(
        `/api/v1/shops/${shopC}/orders/${orderD}`,
      );
      const viaOtherShop = await sellerC.get(
        `/api/v1/shops/${shopD}/orders/${orderD}`,
      );
      expect(viaOwnShop.status).toBe(404);
      expect(viaOtherShop.status).toBe(403);
      expect(JSON.stringify(viaOwnShop.body)).not.toContain(NOTE_D);
      expect(JSON.stringify(viaOtherShop.body)).not.toContain(NOTE_D);
    });

    it('chi tiết đơn không có lời nhắn trả buyerNote = null (khoá có mặt, không bị bỏ)', async () => {
      const res = await sellerC.get(
        `/api/v1/shops/${shopC}/orders/${orderCNoNote}`,
      );

      expect(res.status).toBe(200);
      const data = body(res) as Record<string, unknown>;
      expect(data).toHaveProperty('buyerNote', null);
    });

    it('nội dung chứa HTML được trả NGUYÊN VĂN dạng text (không escape, không cắt) — React escape lúc hiển thị', async () => {
      const list = await sellerC.get(`/api/v1/shops/${shopC}/orders?limit=50`);
      const detail = await sellerC.get(
        `/api/v1/shops/${shopC}/orders/${orderCHtml}`,
      );

      const listItem = sellerOrderListResponseSchema
        .parse(body(list))
        .items.find((o) => o.id === orderCHtml);
      expect(listItem?.buyerNote).toBe(HTML_NOTE);
      expect(sellerOrderDetailSchema.parse(body(detail)).buyerNote).toBe(
        HTML_NOTE,
      );
    });
  });
});
