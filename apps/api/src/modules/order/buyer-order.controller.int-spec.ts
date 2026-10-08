import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  orderDetailSchema,
  orderListResponseSchema,
  type OrderDetail,
  type OrderListResponse,
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

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho GET /orders và GET /orders/:id
// (Week8.md 2.4): đăng nhập thật bằng cookie httpOnly, dữ liệu dựng thẳng bằng Prisma. Chứng minh điều
// unit test với mock không chứng minh được — người dùng A KHÔNG thấy/đọc được đơn của B, response
// parse được bằng đúng Zod schema FE sẽ dùng, và query thật (lọc tab, phân trang, đếm) chạy đúng.
// Chạy: `pnpm test:int`.
const TAG = 'it-buyer-orders-';

interface SeedOrder {
  userId: string;
  status: OrderStatus;
  createdAt?: Date;
  // Lúc đơn chuyển sang `status` (dòng lịch sử `→ status`); mặc định mốc cố định trong quá khứ. Cần đặt
  // tường minh khi test cửa sổ trả hàng — mốc cố định sẽ hết hạn dần theo thời gian thật.
  statusAt?: Date;
  itemCount?: number;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  // null = COD (không hết hạn); mặc định 15 phút nữa.
  expiresAt?: Date | null;
  buyerNote?: string | null;
}

const fakeMail = createFakeMail();

describe('BuyerOrderController (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const agentA = () => request.agent(app.getHttpServer());
  let a: ReturnType<typeof agentA>;
  let b: ReturnType<typeof agentA>;
  let userAId: string;
  let userBId: string;

  async function registerAndLogin(suffix: string) {
    const agent = agentA();
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

  async function seedOrder(input: SeedOrder) {
    const group = await createCheckoutGroup(prisma, input.userId);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 100 });
    const itemCount = input.itemCount ?? 1;

    const order = await prisma.order.create({
      data: {
        userId: input.userId,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: input.status,
        createdAt: input.createdAt,
        totalAmount: 100_000 * itemCount + 20_000,
        shippingFee: 20_000,
        buyerNote: input.buyerNote,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: Array.from({ length: itemCount }, (_, i) => ({
            productVariantId: variant.id,
            quantity: 1,
            priceAtPurchase: 100_000,
            productName: `${TAG}sp-${i + 1}`,
            sku: `SKU-${stamp}-${i + 1}`,
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
              actorId: input.userId,
              createdAt: new Date('2026-10-01T10:00:00.000Z'),
            },
            ...(input.status !== 'AWAITING_PAYMENT'
              ? [
                  {
                    fromStatus: 'AWAITING_PAYMENT' as const,
                    toStatus: input.status,
                    actorType: 'SYSTEM' as const,
                    createdAt:
                      input.statusAt ?? new Date('2026-10-01T10:05:00.000Z'),
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });

    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: input.paymentMethod ?? 'VNPAY',
        status: input.paymentStatus ?? 'PENDING',
        amount: 100_000 * itemCount + 20_000,
        txnRef: `${TAG.toUpperCase()}${stamp}${order.id.slice(0, 8)}`,
        expiresAt:
          input.expiresAt === undefined
            ? new Date(Date.now() + 15 * 60_000)
            : input.expiresAt,
      },
    });
    return order.id;
  }

  const getList = async (agent: typeof a, query = '') => {
    const res = await agent.get(`/api/v1/orders${query}`);
    return res;
  };

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

    ({ agent: a, userId: userAId } = await registerAndLogin('a'));
    ({ agent: b, userId: userBId } = await registerAndLogin('b'));
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  it('chưa đăng nhập — 401 cho cả danh sách lẫn chi tiết', async () => {
    const anonymous = request(app.getHttpServer());
    await anonymous.get('/api/v1/orders').expect(401);
    await anonymous.get('/api/v1/orders/any-id').expect(401);
  });

  describe('danh sách', () => {
    let aUnpaid: string;
    let aPendingOnline: string;
    let aPendingCod: string;
    let aShipping: string;
    let aProcessing: string;
    let aMany: string;
    let bOrder: string;

    beforeAll(async () => {
      // Thời gian tăng dần để kiểm thứ tự "mới nhất trước".
      const t = (minutes: number) =>
        new Date(Date.parse('2026-10-01T09:00:00.000Z') + minutes * 60_000);
      aUnpaid = await seedOrder({
        userId: userAId,
        status: 'AWAITING_PAYMENT',
        createdAt: t(1),
      });
      aPendingOnline = await seedOrder({
        userId: userAId,
        status: 'PENDING',
        paymentStatus: 'SUCCESS',
        createdAt: t(2),
      });
      aPendingCod = await seedOrder({
        userId: userAId,
        status: 'PENDING',
        paymentMethod: 'COD',
        expiresAt: null,
        createdAt: t(3),
      });
      aProcessing = await seedOrder({
        userId: userAId,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        createdAt: t(4),
      });
      aShipping = await seedOrder({
        userId: userAId,
        status: 'SHIPPING',
        paymentStatus: 'SUCCESS',
        createdAt: t(5),
      });
      aMany = await seedOrder({
        userId: userAId,
        status: 'COMPLETED',
        paymentStatus: 'SUCCESS',
        itemCount: 5,
        createdAt: t(6),
      });
      bOrder = await seedOrder({
        userId: userBId,
        status: 'PENDING',
        paymentStatus: 'SUCCESS',
        createdAt: t(7),
      });
    });

    it('chỉ trả đơn của CHÍNH người gọi, mới nhất trước, parse được bằng schema dùng chung', async () => {
      const res = await getList(a, '?limit=50');

      expect(res.status).toBe(200);
      const data: OrderListResponse = orderListResponseSchema.parse(
        (res.body as { data: unknown }).data,
      );
      const ids = data.items.map((o) => o.id);
      expect(ids).toEqual([
        aMany,
        aShipping,
        aProcessing,
        aPendingCod,
        aPendingOnline,
        aUnpaid,
      ]);
      expect(ids).not.toContain(bOrder);
      expect(data.total).toBe(6);

      const dataB = orderListResponseSchema.parse(
        ((await getList(b)).body as { data: unknown }).data,
      );
      expect(dataB.items.map((o) => o.id)).toEqual([bOrder]);
    });

    it.each([
      ['awaiting-payment', ['aUnpaid']],
      ['pending', ['aPendingCod', 'aPendingOnline']],
      ['processing', ['aProcessing']],
      ['shipping', ['aShipping']],
      ['completed', ['aMany']],
      ['cancelled', []],
    ])('tab=%s lọc đúng nhóm trạng thái', async (tab, expectedKeys) => {
      const ids: Record<string, string> = {
        aUnpaid,
        aPendingOnline,
        aPendingCod,
        aProcessing,
        aShipping,
        aMany,
      };
      const res = await getList(a, `?tab=${tab}`);

      expect(res.status).toBe(200);
      const data = orderListResponseSchema.parse(
        (res.body as { data: unknown }).data,
      );
      expect(data.items.map((o) => o.id)).toEqual(
        expectedKeys.map((key) => ids[key]),
      );
      expect(data.total).toBe(expectedKeys.length);
    });

    it('phân trang: total là tổng thật, mỗi trang đúng limit, không trùng đơn giữa các trang', async () => {
      const page1 = orderListResponseSchema.parse(
        ((await getList(a, '?limit=4&page=1')).body as { data: unknown }).data,
      );
      const page2 = orderListResponseSchema.parse(
        ((await getList(a, '?limit=4&page=2')).body as { data: unknown }).data,
      );

      expect(page1.total).toBe(6);
      expect(page1.items).toHaveLength(4);
      expect(page2.items).toHaveLength(2);
      const all = [...page1.items, ...page2.items].map((o) => o.id);
      expect(new Set(all).size).toBe(6);
    });

    it.each(['?tab=refunded', '?limit=51', '?limit=0', '?page=abc'])(
      'query sai %s — 400',
      async (query) => {
        const res = await getList(a, query);
        expect(res.status).toBe(400);
      },
    );

    it('xem nhanh tối đa 3 dòng hàng nhưng itemCount là tổng thật', async () => {
      const data = orderListResponseSchema.parse(
        ((await getList(a, '?tab=completed')).body as { data: unknown }).data,
      );

      expect(data.items[0].items).toHaveLength(3);
      expect(data.items[0].itemCount).toBe(5);
    });

    it('cờ hành động đúng theo trạng thái và phương thức thanh toán', async () => {
      const data = orderListResponseSchema.parse(
        ((await getList(a, '?limit=50')).body as { data: unknown }).data,
      );
      const byId = Object.fromEntries(data.items.map((o) => [o.id, o]));

      expect(byId[aUnpaid]).toMatchObject({
        canCancel: true,
        canRetryPayment: true,
        canConfirmReceived: false,
      });
      expect(byId[aPendingOnline]).toMatchObject({
        paymentMethod: 'VNPAY',
        paymentStatus: 'SUCCESS',
        canCancel: true, // đã trả online nhưng shop chưa xác nhận — hủy ngay kèm hoàn tiền (Week9.md 2.6)
        canRetryPayment: false,
      });
      expect(byId[aPendingCod]).toMatchObject({
        paymentMethod: 'COD',
        canCancel: true,
        canRetryPayment: false,
      });
      expect(byId[aShipping]).toMatchObject({
        canCancel: false,
        canConfirmReceived: true,
      });
    });

    describe('chi tiết', () => {
      it('đơn của mình — 200, parse được bằng schema dùng chung, đủ dòng hàng + timeline cũ → mới', async () => {
        const res = await a.get(`/api/v1/orders/${aMany}`);

        expect(res.status).toBe(200);
        const order: OrderDetail = orderDetailSchema.parse(
          (res.body as { data: unknown }).data,
        );
        expect(order.items).toHaveLength(5);
        expect(order.itemCount).toBe(5);
        expect(order.subtotal).toBe('500000');
        expect(order.shippingFee).toBe('20000');
        expect(order.totalAmount).toBe('520000');
        expect(order.recipientName).toBe('Nguyễn Văn A');
        expect(order.history.map((h) => h.toStatus)).toEqual([
          'AWAITING_PAYMENT',
          'COMPLETED',
        ]);
        expect(order.history[0].fromStatus).toBeNull();
        // Không lộ actorId (định danh người thực hiện) cho buyer.
        for (const entry of (res.body as { data: { history: object[] } }).data
          .history) {
          expect(entry).not.toHaveProperty('actorId');
        }
      });

      it('đơn của NGƯỜI KHÁC — 404 ORDER_NOT_FOUND, y hệt đơn không tồn tại (không lộ id có thật)', async () => {
        const other = await a.get(`/api/v1/orders/${bOrder}`);
        const missing = await a.get('/api/v1/orders/khong-ton-tai');

        expect(other.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(other.body).toEqual(missing.body);
        expect((other.body as { code: string }).code).toBe('ORDER_NOT_FOUND');
      });

      it('chiều ngược lại: B cũng không đọc được đơn của A', async () => {
        const res = await b.get(`/api/v1/orders/${aUnpaid}`);
        expect(res.status).toBe(404);
      });
    });
  });

  // Lời nhắn người mua đã gửi cho shop (Week8.md 3B): thấy ở CHI TIẾT đơn của chính mình (mỗi đơn một
  // lời nhắn riêng), không có ở danh sách, và người khác không đọc được qua đơn của mình.
  describe('buyerNote (Week8.md 3B)', () => {
    const NOTE_1 = 'Giao giờ hành chính, gọi trước khi giao';
    const NOTE_2 = '<img src=x onerror=alert(1)> & "quote"';
    let c: ReturnType<typeof agentA>;
    let withNote1: string;
    let withNote2: string;
    let withoutNote: string;

    beforeAll(async () => {
      const registered = await registerAndLogin('c');
      c = registered.agent;
      withNote1 = await seedOrder({
        userId: registered.userId,
        status: 'PENDING',
        buyerNote: NOTE_1,
      });
      withNote2 = await seedOrder({
        userId: registered.userId,
        status: 'PENDING',
        buyerNote: NOTE_2,
      });
      withoutNote = await seedOrder({
        userId: registered.userId,
        status: 'PENDING',
      });
    });

    it('chi tiết: mỗi đơn trả đúng lời nhắn của nó; HTML trả nguyên văn dạng text; không có ⇒ null', async () => {
      const read = async (id: string) =>
        orderDetailSchema.parse(
          ((await c.get(`/api/v1/orders/${id}`)).body as { data: unknown })
            .data,
        );

      expect((await read(withNote1)).buyerNote).toBe(NOTE_1);
      expect((await read(withNote2)).buyerNote).toBe(NOTE_2);
      expect((await read(withoutNote)).buyerNote).toBeNull();
    });

    it('danh sách đơn của tôi KHÔNG có khoá buyerNote (chỉ chi tiết mới cần)', async () => {
      const res = await c.get('/api/v1/orders?limit=50');

      expect(res.status).toBe(200);
      const items = (res.body as { data: { items: object[] } }).data.items;
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item).not.toHaveProperty('buyerNote');
      }
    });

    it('người mua khác đọc đơn này ⇒ 404 và không rò lời nhắn', async () => {
      const res = await a.get(`/api/v1/orders/${withNote1}`);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(NOTE_1);
    });
  });

  // Week9.md 2.3 — cờ xin hủy / xin trả hàng đọc từ DB thật: yêu cầu chưa rút (relation `refundRequests`
  // lọc status ≠ WITHDRAWN) và lúc COMPLETED (dòng lịch sử `→ COMPLETED`, lọc ở select của danh sách).
  describe('yêu cầu hủy/trả hàng (Week9.md 2.3)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

    const flagsOf = async (orderId: string) => {
      const list = orderListResponseSchema.parse(
        ((await getList(a, '?limit=50')).body as { data: unknown }).data,
      );
      const item = list.items.find((o) => o.id === orderId);
      expect(item).toBeDefined();
      return item!;
    };

    const requestFor = async (
      orderId: string,
      status: 'PENDING_SELLER' | 'WITHDRAWN',
      kind: 'CANCEL' | 'RETURN',
    ) => {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { shopId: true, userId: true },
      });
      await prisma.refundRequest.create({
        data: {
          orderId,
          shopId: order.shopId,
          userId: order.userId,
          kind,
          status,
          reasonCode: 'OTHER',
          reasonNote: 'it',
          sellerRespondBy: new Date(Date.now() + 2 * DAY_MS),
        },
      });
    };

    it('shop đã xác nhận/đóng gói: xin hủy được; có yêu cầu hủy chưa rút thì tắt; rút rồi bật lại', async () => {
      const id = await seedOrder({
        userId: userAId,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
      });

      expect(await flagsOf(id)).toMatchObject({
        canRequestCancel: true,
        canCancel: false,
        canRequestReturn: false,
      });

      await requestFor(id, 'PENDING_SELLER', 'CANCEL');
      expect((await flagsOf(id)).canRequestCancel).toBe(false);

      await prisma.refundRequest.updateMany({
        where: { orderId: id },
        data: { status: 'WITHDRAWN' },
      });
      expect((await flagsOf(id)).canRequestCancel).toBe(true);
    });

    it('yêu cầu TRẢ HÀNG không chặn yêu cầu hủy (khác loại)', async () => {
      const id = await seedOrder({
        userId: userAId,
        status: 'PACKED',
        paymentStatus: 'SUCCESS',
      });
      await requestFor(id, 'PENDING_SELLER', 'RETURN');

      expect((await flagsOf(id)).canRequestCancel).toBe(true);
    });

    it('đơn COMPLETED: trả hàng được trong cửa sổ 7 ngày kể từ lúc hoàn tất, quá hạn thì tắt (cả danh sách lẫn chi tiết)', async () => {
      const fresh = await seedOrder({
        userId: userAId,
        status: 'COMPLETED',
        paymentStatus: 'SUCCESS',
        statusAt: daysAgo(2),
      });
      const expired = await seedOrder({
        userId: userAId,
        status: 'COMPLETED',
        paymentStatus: 'SUCCESS',
        statusAt: daysAgo(8),
      });

      expect((await flagsOf(fresh)).canRequestReturn).toBe(true);
      expect((await flagsOf(expired)).canRequestReturn).toBe(false);

      // Chi tiết đọc lúc COMPLETED từ ĐỦ lịch sử (không phải select lọc của danh sách) nhưng cùng kết quả.
      const detail = orderDetailSchema.parse(
        ((await a.get(`/api/v1/orders/${fresh}`)).body as { data: unknown })
          .data,
      );
      expect(detail.canRequestReturn).toBe(true);
      const expiredDetail = orderDetailSchema.parse(
        ((await a.get(`/api/v1/orders/${expired}`)).body as { data: unknown })
          .data,
      );
      expect(expiredDetail.canRequestReturn).toBe(false);
    });

    it('đã có yêu cầu trả hàng (chưa rút) thì tắt; yêu cầu hủy cũ không chặn', async () => {
      const id = await seedOrder({
        userId: userAId,
        status: 'COMPLETED',
        paymentStatus: 'SUCCESS',
        statusAt: daysAgo(1),
      });
      await requestFor(id, 'PENDING_SELLER', 'CANCEL');
      expect((await flagsOf(id)).canRequestReturn).toBe(true);

      await requestFor(id, 'PENDING_SELLER', 'RETURN');
      expect((await flagsOf(id)).canRequestReturn).toBe(false);
    });

    it('người mua khác KHÔNG thấy yêu cầu của đơn này trong cờ của mình (cờ theo đơn của chính mình)', async () => {
      const id = await seedOrder({
        userId: userBId,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
      });
      await requestFor(id, 'PENDING_SELLER', 'CANCEL');

      const list = orderListResponseSchema.parse(
        ((await getList(a, '?limit=50')).body as { data: unknown }).data,
      );
      expect(list.items.find((o) => o.id === id)).toBeUndefined();
      expect((await a.get(`/api/v1/orders/${id}`)).status).toBe(404);
    });
  });
});
