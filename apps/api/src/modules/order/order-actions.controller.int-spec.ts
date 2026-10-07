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
import { orderDetailSchema, sellerOrderDetailSchema } from '@ecommerce/types';
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
  seedOrderHistory,
} from '../../shared/testing/db-fixtures';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho các HÀNH ĐỘNG đổi trạng thái đơn
// (Week8.md 2.6): seller xác nhận/đóng gói/giao/từ chối, buyer hủy/xác nhận đã nhận, hủy nhóm chưa
// thanh toán. Chứng minh điều unit test với mock không chứng minh được: hoàn kho thật, thu tiền COD thật,
// timeline ghi đúng người thực hiện, và tranh chấp đồng thời (buyer hủy vs seller xác nhận, 2 đơn COD
// cùng nhóm được xác nhận nhận hàng cùng lúc). Chạy: `pnpm test:int`.
const TAG = 'it-order-actions-';
const STOCK = 10;
const QTY = 2;

interface SeedLine {
  shopId: string;
  status: OrderStatus;
}

const fakeMail = createFakeMail();

describe('Hành động đơn hàng (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let sellerA: Agent;
  let sellerC: Agent;
  let buyer: Agent;
  let otherBuyer: Agent;
  let buyerId: string;
  let shopA: string;
  let shopA2: string;
  let shopC: string;
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

  // 1 nhóm thanh toán + N đơn (mỗi đơn 1 variant riêng, 2 sản phẩm/đơn) + 1 Payment. `stock` của
  // variant được dựng ở trạng thái SAU khi đã chốt kho (đơn PENDING trở đi) hoặc đang giữ chỗ (đơn
  // AWAITING_PAYMENT: reservedStock = QTY) — đúng như placeOrder/confirmPayment để lại.
  async function seedGroup(
    lines: SeedLine[],
    payment: {
      method: PaymentMethod;
      status: PaymentStatus;
      expiresAt?: Date | null;
    },
    userId = buyerId,
  ) {
    const group = await createCheckoutGroup(prisma, userId);
    const orderIds: string[] = [];
    const variantIds: string[] = [];
    for (const line of lines) {
      const base = await createShopWithProduct(prisma, TAG);
      const unpaid = line.status === 'AWAITING_PAYMENT';
      const variant = await createVariant(prisma, base, {
        stock: STOCK,
        reservedStock: unpaid ? QTY : 0,
      });
      const order = await prisma.order.create({
        data: {
          userId,
          shopId: line.shopId,
          checkoutGroupId: group.id,
          status: line.status,
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
          // Lịch sử THỰC TẾ theo trạng thái + cách thanh toán (bộ lọc Seller dựa vào việc đơn từng ở PENDING).
          statusHistory: {
            create: seedOrderHistory(line.status, {
              isCod: payment.method === 'COD',
            }).map((row) => ({
              ...row,
              actorId: row.actorType === 'BUYER' ? userId : undefined,
            })),
          },
        },
        select: { id: true },
      });
      orderIds.push(order.id);
      variantIds.push(variant.id);
    }
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: payment.method,
        status: payment.status,
        amount: 220_000 * lines.length,
        txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
        expiresAt:
          payment.expiresAt === undefined
            ? new Date(Date.now() + 15 * 60_000)
            : payment.expiresAt,
      },
    });
    return { groupId: group.id, orderIds, variantIds };
  }

  const onlinePaid = { method: 'VNPAY', status: 'SUCCESS' } as const;
  const cod = { method: 'COD', status: 'PENDING', expiresAt: null } as const;

  async function seedOne(
    status: OrderStatus,
    payment: Parameters<typeof seedGroup>[1] = onlinePaid,
    shopId = shopA,
  ) {
    const g = await seedGroup([{ shopId, status }], payment);
    return { orderId: g.orderIds[0], variantId: g.variantIds[0], ...g };
  }

  const stockOf = (variantId: string) =>
    prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true, reservedStock: true },
    });
  const statusOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
  const historyOf = (orderId: string) =>
    prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const details = (res: { body: unknown }) =>
    (res.body as { details?: unknown }).details;

  const sellerUrl = (shopId: string, orderId: string, action: string) =>
    `/api/v1/shops/${shopId}/orders/${orderId}/${action}`;
  const buyerUrl = (orderId: string, action: string) =>
    `/api/v1/orders/${orderId}/${action}`;

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
    const c = await registerAndLogin('c');
    const s = await registerAndLogin('s');
    const b = await registerAndLogin('buyer');
    const o = await registerAndLogin('other');
    sellerA = a.agent;
    sellerC = c.agent;
    sellerSuspended = s.agent;
    buyer = b.agent;
    buyerId = b.userId;
    otherBuyer = o.agent;
    shopA = await createShopFor(a.userId, 'a');
    shopA2 = await createShopFor(a.userId, 'a2');
    shopC = await createShopFor(c.userId, 'c');
    shopSuspended = await createShopFor(s.userId, 's', 'SUSPENDED');
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('email báo buyer (Week8.md 2.8)', () => {
    beforeEach(() => fakeMail.reset());

    const subjects = () => fakeMail.sent.map((m) => m.subject);

    it('xác nhận → đóng gói → giao → nhận hàng: email "đã xác nhận" và "đang giao" (kèm mã vận đơn), đóng gói/nhận hàng không gửi', async () => {
      const { orderId } = await seedOne('PENDING');

      await sellerA.post(sellerUrl(shopA, orderId, 'confirm')).expect(200);
      expect(subjects()).toEqual([`${TAG}shop-a đã xác nhận đơn hàng của bạn`]);

      await sellerA.post(sellerUrl(shopA, orderId, 'pack')).expect(200);
      expect(fakeMail.sent).toHaveLength(1); // đóng gói là bước nội bộ

      await sellerA
        .post(sellerUrl(shopA, orderId, 'ship'))
        .send({ carrier: 'GHN', trackingCode: 'GHN-MAIL-1' })
        .expect(200);
      expect(subjects()[1]).toBe('Đơn hàng của bạn đang được giao');
      expect(fakeMail.sent[1].html).toContain('GHN-MAIL-1');

      await buyer.post(buyerUrl(orderId, 'confirm-received')).expect(200);
      expect(fakeMail.sent).toHaveLength(2); // nhận hàng: buyer tự bấm, không cần báo
      // Gửi tới đúng buyer.
      const buyerRow = await prisma.user.findUniqueOrThrow({
        where: { id: buyerId },
        select: { email: true },
      });
      expect(fakeMail.sent.every((m) => m.to === buyerRow.email)).toBe(true);
    });

    it('seller từ chối đơn COD: email "bị shop từ chối" kèm lý do (đã escape)', async () => {
      const { orderId } = await seedOne('PENDING', cod);

      await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'Hết hàng <b>x</b>' })
        .expect(200);

      expect(subjects()).toEqual(['Đơn hàng của bạn đã bị shop từ chối']);
      expect(fakeMail.sent[0].html).toContain('Hết hàng &lt;b&gt;x&lt;/b&gt;');
    });

    it('buyer hủy đơn COD: email "Bạn đã hủy đơn hàng"; hủy cả nhóm chưa thanh toán: đúng 1 email cho cả nhóm', async () => {
      const codOrder = await seedOne('PENDING', cod);
      await buyer.post(buyerUrl(codOrder.orderId, 'cancel')).expect(200);
      expect(subjects()).toEqual(['Bạn đã hủy đơn hàng']);

      fakeMail.reset();
      const g = await seedGroup(
        [
          { shopId: shopA, status: 'AWAITING_PAYMENT' },
          { shopId: shopA2, status: 'AWAITING_PAYMENT' },
        ],
        { method: 'VNPAY', status: 'PENDING' },
      );
      await buyer.post(buyerUrl(g.orderIds[0], 'cancel')).expect(200);

      expect(subjects()).toEqual(['Bạn đã hủy đơn hàng']);
      expect((fakeMail.sent[0].html.match(/Mã đơn #/g) ?? []).length).toBe(2);
    });

    it('hành động THẤT BẠI (409/404) không gửi email nào', async () => {
      const { orderId } = await seedOne('PENDING');

      await sellerA.post(sellerUrl(shopA, orderId, 'pack')).expect(409);
      await sellerC.post(sellerUrl(shopA, orderId, 'confirm')).expect(403);
      await buyer.post(buyerUrl(orderId, 'cancel')).expect(409);

      expect(fakeMail.sent).toHaveLength(0);
    });

    it('MAIL LỖI (Resend down) — hành động VẪN thành công 200 và đổi trạng thái, không 500, không rollback', async () => {
      const online = await seedOne('PENDING');
      const codOrder = await seedOne('PENDING', cod);
      fakeMail.failWith(new Error('Resend down'));

      const confirm = await sellerA.post(
        sellerUrl(shopA, online.orderId, 'confirm'),
      );
      const reject = await sellerA
        .post(sellerUrl(shopA, codOrder.orderId, 'reject'))
        .send({ reason: 'Hết hàng' });

      expect(confirm.status).toBe(200);
      expect(reject.status).toBe(200);
      expect(await statusOf(online.orderId)).toBe('CONFIRMED');
      expect(await statusOf(codOrder.orderId)).toBe('CANCELLED');
      // Việc hoàn kho (cùng transaction với hủy) vẫn xảy ra.
      expect((await stockOf(codOrder.variantId)).stock).toBe(STOCK + QTY);
      expect(fakeMail.sent).toHaveLength(0);
    });
  });

  describe('luồng đầy đủ đơn trả online: xác nhận → đóng gói → giao → nhận hàng', () => {
    it('mỗi bước đúng trạng thái, timeline ghi đúng người thực hiện, kho/Payment không đổi', async () => {
      const { orderId, variantId, groupId } = await seedOne('PENDING');

      const confirm = await sellerA.post(sellerUrl(shopA, orderId, 'confirm'));
      expect(confirm.status).toBe(200);
      const confirmed = sellerOrderDetailSchema.parse(data(confirm));
      expect(confirmed).toMatchObject({
        status: 'CONFIRMED',
        canConfirm: false,
        canPack: true,
      });

      const pack = await sellerA.post(sellerUrl(shopA, orderId, 'pack'));
      expect(pack.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(data(pack)).canShip).toBe(true);

      // Giao hàng KÈM vận chuyển.
      const ship = await sellerA
        .post(sellerUrl(shopA, orderId, 'ship'))
        .send({ carrier: 'GHN', trackingCode: 'GHN123456' });
      expect(ship.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(data(ship))).toMatchObject({
        status: 'SHIPPING',
        carrier: 'GHN',
        trackingCode: 'GHN123456',
      });

      // Buyer xác nhận đã nhận — phía buyer thấy đủ mã vận đơn + trạng thái.
      const received = await buyer.post(buyerUrl(orderId, 'confirm-received'));
      expect(received.status).toBe(200);
      const done = orderDetailSchema.parse(data(received));
      expect(done).toMatchObject({
        status: 'COMPLETED',
        carrier: 'GHN',
        trackingCode: 'GHN123456',
        canConfirmReceived: false,
      });

      // Timeline: mốc tạo + thanh toán (seed) + 4 lần chuyển thật, đúng thứ tự và đúng người.
      const history = await historyOf(orderId);
      expect(history.map((h) => [h.toStatus, h.actorType])).toEqual([
        ['AWAITING_PAYMENT', 'BUYER'],
        ['PENDING', 'SYSTEM'],
        ['CONFIRMED', 'SELLER'],
        ['PACKED', 'SELLER'],
        ['SHIPPING', 'SELLER'],
        ['COMPLETED', 'BUYER'],
      ]);
      expect(done.history.map((h) => h.toStatus)).toEqual(
        history.map((h) => h.toStatus),
      );

      // Đơn đã trả online: không động tới kho (đã chốt từ lúc thanh toán) và Payment.
      expect(await stockOf(variantId)).toEqual({
        stock: STOCK,
        reservedStock: 0,
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { checkoutGroupId: groupId },
      });
      expect(payment.status).toBe('SUCCESS');
    });

    it('ship không kèm body vẫn giao được (Express 5: body undefined → mặc định {})', async () => {
      const { orderId } = await seedOne('PACKED');

      const res = await sellerA.post(sellerUrl(shopA, orderId, 'ship'));

      expect(res.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(data(res))).toMatchObject({
        status: 'SHIPPING',
        carrier: null,
        trackingCode: null,
      });
    });

    it('ship với mã vận đơn quá dài — 400', async () => {
      const { orderId } = await seedOne('PACKED');

      const res = await sellerA
        .post(sellerUrl(shopA, orderId, 'ship'))
        .send({ trackingCode: 'x'.repeat(101) });

      expect(res.status).toBe(400);
      expect(await statusOf(orderId)).toBe('PACKED');
    });
  });

  describe('sai trạng thái / sai quyền', () => {
    it('làm sai thứ tự — 409 ORDER_INVALID_TRANSITION, trạng thái không đổi', async () => {
      const { orderId } = await seedOne('PENDING');

      const pack = await sellerA.post(sellerUrl(shopA, orderId, 'pack'));
      const ship = await sellerA.post(sellerUrl(shopA, orderId, 'ship'));

      expect(pack.status).toBe(409);
      expect(code(pack)).toBe('ORDER_INVALID_TRANSITION');
      expect(ship.status).toBe(409);
      expect(await statusOf(orderId)).toBe('PENDING');
    });

    it('xác nhận 2 lần — lần 2 bị 409, history chỉ có 1 dòng xác nhận', async () => {
      const { orderId } = await seedOne('PENDING');

      await sellerA.post(sellerUrl(shopA, orderId, 'confirm')).expect(200);
      const again = await sellerA.post(sellerUrl(shopA, orderId, 'confirm'));

      expect(again.status).toBe(409);
      expect(
        (await historyOf(orderId)).filter((h) => h.toStatus === 'CONFIRMED'),
      ).toHaveLength(1);
    });

    it('seller khác (không phải chủ shop) — 403; chưa đăng nhập — 401', async () => {
      const { orderId } = await seedOne('PENDING');

      await sellerC.post(sellerUrl(shopA, orderId, 'confirm')).expect(403);
      await request(app.getHttpServer())
        .post(sellerUrl(shopA, orderId, 'confirm'))
        .expect(401);
      expect(await statusOf(orderId)).toBe('PENDING');
    });

    it('đơn thuộc shop KHÁC (đi vòng qua shop của mình) — 404, không đổi gì', async () => {
      const { orderId } = await seedOne('PENDING', onlinePaid, shopC);

      const res = await sellerA.post(sellerUrl(shopA, orderId, 'confirm'));

      expect(res.status).toBe(404);
      expect(code(res)).toBe('ORDER_NOT_FOUND');
      expect(await statusOf(orderId)).toBe('PENDING');
    });

    it('đơn AWAITING_PAYMENT của CHÍNH shop mình — 404 (seller không đụng được đơn chưa thanh toán)', async () => {
      const { orderId } = await seedOne('AWAITING_PAYMENT', {
        method: 'VNPAY',
        status: 'PENDING',
      });

      for (const action of ['confirm', 'pack', 'ship']) {
        const res = await sellerA.post(sellerUrl(shopA, orderId, action));
        expect(res.status).toBe(404);
      }
      const reject = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'x' });
      expect(reject.status).toBe(404);
      expect(await statusOf(orderId)).toBe('AWAITING_PAYMENT');
    });

    it('đơn CHƯA TỪNG thanh toán rồi bị hủy (hết hạn) của CHÍNH shop mình — 404, không phải 409 (không lộ là có đơn đó)', async () => {
      const { orderId } = await seedOne('CANCELLED', {
        method: 'VNPAY',
        status: 'FAILED',
      });

      for (const action of ['confirm', 'pack', 'ship']) {
        const res = await sellerA.post(sellerUrl(shopA, orderId, action));
        expect(res.status).toBe(404);
        expect(code(res)).toBe('ORDER_NOT_FOUND');
      }
      const reject = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'x' });
      expect(reject.status).toBe(404);
      expect(await statusOf(orderId)).toBe('CANCELLED');
    });

    it('người mua HỦY NHÓM chưa thanh toán qua API thật — seller của các shop trong nhóm không còn thấy đơn (chi tiết 404), còn buyer vẫn thấy', async () => {
      const g = await seedGroup(
        [
          { shopId: shopA, status: 'AWAITING_PAYMENT' },
          { shopId: shopA2, status: 'AWAITING_PAYMENT' },
        ],
        { method: 'VNPAY', status: 'PENDING' },
      );

      await buyer.post(buyerUrl(g.orderIds[0], 'cancel')).expect(200);

      for (const id of g.orderIds) {
        expect(await statusOf(id)).toBe('CANCELLED');
        const seller = await sellerA.get(`/api/v1/shops/${shopA}/orders/${id}`);
        const seller2 = await sellerA.get(
          `/api/v1/shops/${shopA2}/orders/${id}`,
        );
        expect([seller.status, seller2.status]).toEqual([404, 404]);
        await buyer.get(`/api/v1/orders/${id}`).expect(200);
      }
    });

    it('shop bị khoá tạm (SUSPENDED) vẫn xử lý được đơn đã có (Week8.md 1.8)', async () => {
      const { orderId } = await seedOne('PENDING', onlinePaid, shopSuspended);

      const res = await sellerSuspended.post(
        sellerUrl(shopSuspended, orderId, 'confirm'),
      );

      expect(res.status).toBe(200);
      expect(await statusOf(orderId)).toBe('CONFIRMED');
    });

    it('buyer khác không xác nhận/hủy được đơn của người ta — 404', async () => {
      const shipping = await seedOne('SHIPPING');
      const codPending = await seedOne('PENDING', cod);

      const received = await otherBuyer.post(
        buyerUrl(shipping.orderId, 'confirm-received'),
      );
      const cancel = await otherBuyer.post(
        buyerUrl(codPending.orderId, 'cancel'),
      );

      expect(received.status).toBe(404);
      expect(cancel.status).toBe(404);
      expect(await statusOf(shipping.orderId)).toBe('SHIPPING');
      expect(await statusOf(codPending.orderId)).toBe('PENDING');
    });

    it('xác nhận đã nhận khi đơn chưa giao — 409', async () => {
      const { orderId } = await seedOne('PACKED');

      const res = await buyer.post(buyerUrl(orderId, 'confirm-received'));

      expect(res.status).toBe(409);
      expect(code(res)).toBe('ORDER_INVALID_TRANSITION');
    });
  });

  describe('từ chối đơn COD (seller) và hủy đơn COD (buyer): hoàn kho', () => {
    it('seller từ chối đơn COD chờ xác nhận — CANCELLED, kho +qty, lý do vào timeline', async () => {
      const { orderId, variantId } = await seedOne('PENDING', cod);

      const res = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'Hết hàng' });

      expect(res.status).toBe(200);
      expect(sellerOrderDetailSchema.parse(data(res))).toMatchObject({
        status: 'CANCELLED',
        canConfirm: false,
        canReject: false,
      });
      expect(await stockOf(variantId)).toEqual({
        stock: STOCK + QTY,
        reservedStock: 0,
      });
      const last = (await historyOf(orderId)).at(-1);
      expect(last).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        actorType: 'SELLER',
        note: 'Hết hàng',
      });
    });

    it('từ chối thiếu lý do — 400, không đổi gì', async () => {
      const { orderId, variantId } = await seedOne('PENDING', cod);

      const res = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: '   ' });

      expect(res.status).toBe(400);
      expect(await statusOf(orderId)).toBe('PENDING');
      expect((await stockOf(variantId)).stock).toBe(STOCK);
    });

    it('từ chối KHÔNG gửi body — 400 báo lỗi theo field reason (không phải "value: Required"), không đổi gì', async () => {
      const { orderId, variantId } = await seedOne('PENDING', cod);

      // Express 5: không gửi body ⇒ req.body là undefined (khác `{}`).
      const res = await sellerA.post(sellerUrl(shopA, orderId, 'reject'));

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'reason: order.validationReasonRequired',
      );
      expect(await statusOf(orderId)).toBe('PENDING');
      expect((await stockOf(variantId)).stock).toBe(STOCK);
    });

    it('seller KHÔNG từ chối được đơn đã trả online — 409 PAID_ONLINE, không hoàn kho', async () => {
      const { orderId, variantId } = await seedOne('PENDING', onlinePaid);

      const res = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'Hết hàng' });

      expect(res.status).toBe(409);
      expect(code(res)).toBe('ORDER_CANCEL_NOT_ALLOWED');
      expect(details(res)).toEqual({ reason: 'PAID_ONLINE' });
      expect(await statusOf(orderId)).toBe('PENDING');
      expect((await stockOf(variantId)).stock).toBe(STOCK);
    });

    it('seller KHÔNG từ chối được đơn đã xác nhận — 409 PROCESSING_STARTED', async () => {
      const { orderId } = await seedOne('CONFIRMED', cod);

      const res = await sellerA
        .post(sellerUrl(shopA, orderId, 'reject'))
        .send({ reason: 'x' });

      expect(res.status).toBe(409);
      expect(details(res)).toEqual({ reason: 'PROCESSING_STARTED' });
    });

    it('buyer hủy đơn COD chờ xác nhận — CANCELLED, kho +qty, actor BUYER; không body vẫn hủy được', async () => {
      const { orderId, variantId } = await seedOne('PENDING', cod);

      const res = await buyer.post(buyerUrl(orderId, 'cancel'));

      expect(res.status).toBe(200);
      expect(orderDetailSchema.parse(data(res))).toMatchObject({
        status: 'CANCELLED',
        canCancel: false,
      });
      expect(await stockOf(variantId)).toEqual({
        stock: STOCK + QTY,
        reservedStock: 0,
      });
      // Không nhập lý do ⇒ note là null (KHÔNG ghi chuỗi mặc định: note của buyer hiển thị nguyên văn).
      expect((await historyOf(orderId)).at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        actorId: buyerId,
        note: null,
      });
    });

    it('buyer hủy kèm lý do — lý do vào timeline, và SELLER của đơn đọc được lý do đó qua API', async () => {
      const { orderId } = await seedOne('PENDING', cod);

      await buyer
        .post(buyerUrl(orderId, 'cancel'))
        .send({ reason: 'Đặt nhầm' })
        .expect(200);

      expect((await historyOf(orderId)).at(-1)?.note).toBe('Đặt nhầm');
      const seller = await sellerA.get(
        `/api/v1/shops/${shopA}/orders/${orderId}`,
      );
      expect(seller.status).toBe(200);
      const last = sellerOrderDetailSchema.parse(data(seller)).history.at(-1);
      expect(last).toMatchObject({
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        note: 'Đặt nhầm',
      });
    });

    it('buyer KHÔNG hủy được đơn đã trả online — 409 PAID_ONLINE; đơn đã xác nhận — PROCESSING_STARTED', async () => {
      const online = await seedOne('PENDING', onlinePaid);
      const confirmedCod = await seedOne('CONFIRMED', cod);

      const r1 = await buyer.post(buyerUrl(online.orderId, 'cancel'));
      const r2 = await buyer.post(buyerUrl(confirmedCod.orderId, 'cancel'));

      expect(r1.status).toBe(409);
      expect(details(r1)).toEqual({ reason: 'PAID_ONLINE' });
      expect(r2.status).toBe(409);
      expect(details(r2)).toEqual({ reason: 'PROCESSING_STARTED' });
      expect(await statusOf(online.orderId)).toBe('PENDING');
      expect(await statusOf(confirmedCod.orderId)).toBe('CONFIRMED');
    });
  });

  describe('hủy đơn chưa thanh toán (theo nhóm)', () => {
    const unpaid = { method: 'VNPAY', status: 'PENDING' } as const;

    it('POST /orders/:id/cancel trên đơn chưa thanh toán — hủy CẢ NHÓM, nhả giữ chỗ, actor BUYER', async () => {
      const g = await seedGroup(
        [
          { shopId: shopA, status: 'AWAITING_PAYMENT' },
          { shopId: shopA2, status: 'AWAITING_PAYMENT' },
        ],
        unpaid,
      );

      const res = await buyer
        .post(buyerUrl(g.orderIds[0], 'cancel'))
        .send({ reason: 'Đổi ý' });

      expect(res.status).toBe(200);
      expect(orderDetailSchema.parse(data(res)).status).toBe('CANCELLED');
      for (const id of g.orderIds) expect(await statusOf(id)).toBe('CANCELLED');
      for (const v of g.variantIds) {
        expect(await stockOf(v)).toEqual({ stock: STOCK, reservedStock: 0 });
      }
      expect((await historyOf(g.orderIds[1])).at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        note: 'Đổi ý',
      });
    });

    it('hủy nhóm chưa thanh toán KHÔNG nhập lý do — note là null (không ghi chuỗi mặc định)', async () => {
      const g = await seedGroup(
        [{ shopId: shopA, status: 'AWAITING_PAYMENT' }],
        unpaid,
      );

      await buyer.post(buyerUrl(g.orderIds[0], 'cancel')).expect(200);

      expect((await historyOf(g.orderIds[0])).at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        note: null,
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { checkoutGroupId: g.groupId },
      });
      expect(payment.status).toBe('FAILED');
    });

    it('POST /checkout/groups/:groupId/cancel — hủy nhóm, trả trạng thái CANCELLED; gọi lại vẫn 200 (idempotent)', async () => {
      const g = await seedGroup(
        [{ shopId: shopA, status: 'AWAITING_PAYMENT' }],
        unpaid,
      );

      const first = await buyer.post(
        `/api/v1/checkout/groups/${g.groupId}/cancel`,
      );
      const second = await buyer.post(
        `/api/v1/checkout/groups/${g.groupId}/cancel`,
      );

      expect(first.status).toBe(200);
      expect(data(first)).toMatchObject({
        status: 'CANCELLED',
        canRetry: false,
      });
      expect(second.status).toBe(200);
      expect(data(second)).toMatchObject({ status: 'CANCELLED' });
      // Nhả giữ chỗ đúng 1 lần dù gọi 2 lần.
      expect(await stockOf(g.variantIds[0])).toEqual({
        stock: STOCK,
        reservedStock: 0,
      });
      expect(
        (await historyOf(g.orderIds[0])).filter(
          (h) => h.toStatus === 'CANCELLED',
        ),
      ).toHaveLength(1);
    });

    it('nhóm đã thanh toán — 409 PAID_ONLINE, không đụng gì', async () => {
      const g = await seedGroup(
        [{ shopId: shopA, status: 'PENDING' }],
        onlinePaid,
      );

      const res = await buyer.post(
        `/api/v1/checkout/groups/${g.groupId}/cancel`,
      );

      expect(res.status).toBe(409);
      expect(code(res)).toBe('ORDER_CANCEL_NOT_ALLOWED');
      expect(details(res)).toEqual({ reason: 'PAID_ONLINE' });
      expect(await statusOf(g.orderIds[0])).toBe('PENDING');
    });

    it('nhóm của người khác — 404; chưa đăng nhập — 401', async () => {
      const g = await seedGroup(
        [{ shopId: shopA, status: 'AWAITING_PAYMENT' }],
        unpaid,
      );

      await otherBuyer
        .post(`/api/v1/checkout/groups/${g.groupId}/cancel`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/checkout/groups/${g.groupId}/cancel`)
        .expect(401);
      expect(await statusOf(g.orderIds[0])).toBe('AWAITING_PAYMENT');
    });
  });

  describe('thu tiền COD khi nhận hàng', () => {
    it('nhóm 2 đơn COD (2 shop): nhận đơn thứ nhất CHƯA thu tiền, nhận đơn thứ hai mới ghi Payment SUCCESS + paidAt', async () => {
      const g = await seedGroup(
        [
          { shopId: shopA, status: 'SHIPPING' },
          { shopId: shopA2, status: 'SHIPPING' },
        ],
        cod,
      );
      const paymentOf = () =>
        prisma.payment.findFirstOrThrow({
          where: { checkoutGroupId: g.groupId },
        });

      await buyer.post(buyerUrl(g.orderIds[0], 'confirm-received')).expect(200);
      expect((await paymentOf()).status).toBe('PENDING');

      await buyer.post(buyerUrl(g.orderIds[1], 'confirm-received')).expect(200);
      const payment = await paymentOf();
      expect(payment.status).toBe('SUCCESS');
      expect(payment.paidAt).not.toBeNull();
    });

    it('đơn COD bị hủy trong nhóm không cản việc thu tiền', async () => {
      const g = await seedGroup(
        [
          { shopId: shopA, status: 'SHIPPING' },
          { shopId: shopA2, status: 'CANCELLED' },
        ],
        cod,
      );

      await buyer.post(buyerUrl(g.orderIds[0], 'confirm-received')).expect(200);

      const payment = await prisma.payment.findFirstOrThrow({
        where: { checkoutGroupId: g.groupId },
      });
      expect(payment.status).toBe('SUCCESS');
    });

    describe('hủy/từ chối đơn COD CUỐI CÙNG chưa tới đích (đơn kia đã COMPLETED từ trước)', () => {
      const paymentOf = (groupId: string) =>
        prisma.payment.findFirstOrThrow({
          where: { checkoutGroupId: groupId },
        });

      it('buyer nhận đơn 1 (chưa thu) rồi HỦY đơn 2 — Payment SUCCESS + paidAt, kho đơn 2 hoàn lại', async () => {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'SHIPPING' },
            { shopId: shopA2, status: 'PENDING' },
          ],
          cod,
        );

        await buyer
          .post(buyerUrl(g.orderIds[0], 'confirm-received'))
          .expect(200);
        expect((await paymentOf(g.groupId)).status).toBe('PENDING');

        await buyer.post(buyerUrl(g.orderIds[1], 'cancel')).expect(200);

        const payment = await paymentOf(g.groupId);
        expect(payment.status).toBe('SUCCESS');
        expect(payment.paidAt).not.toBeNull();
        expect(await statusOf(g.orderIds[1])).toBe('CANCELLED');
        expect((await stockOf(g.variantIds[1])).stock).toBe(STOCK + QTY);
      });

      it('buyer nhận đơn 1 rồi SELLER TỪ CHỐI đơn 2 — Payment SUCCESS', async () => {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'SHIPPING' },
            { shopId: shopA2, status: 'PENDING' },
          ],
          cod,
        );
        await buyer
          .post(buyerUrl(g.orderIds[0], 'confirm-received'))
          .expect(200);

        await sellerA
          .post(sellerUrl(shopA2, g.orderIds[1], 'reject'))
          .send({ reason: 'Hết hàng' })
          .expect(200);

        expect((await paymentOf(g.groupId)).status).toBe('SUCCESS');
      });

      it('HỦY đơn 2 TRƯỚC khi đơn 1 hoàn tất — chưa thu; nhận đơn 1 xong mới thu (đường cũ vẫn đúng)', async () => {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'SHIPPING' },
            { shopId: shopA2, status: 'PENDING' },
          ],
          cod,
        );

        await buyer.post(buyerUrl(g.orderIds[1], 'cancel')).expect(200);
        expect((await paymentOf(g.groupId)).status).toBe('PENDING');

        await buyer
          .post(buyerUrl(g.orderIds[0], 'confirm-received'))
          .expect(200);
        expect((await paymentOf(g.groupId)).status).toBe('SUCCESS');
      });

      it('hủy một đơn khi nhóm còn đơn khác ĐANG GIAO — chưa thu tiền', async () => {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'SHIPPING' },
            { shopId: shopA2, status: 'PENDING' },
          ],
          cod,
        );

        await buyer.post(buyerUrl(g.orderIds[1], 'cancel')).expect(200);

        expect((await paymentOf(g.groupId)).status).toBe('PENDING');
      });

      it('hủy HẾT mọi đơn của nhóm (không có đơn COMPLETED) — KHÔNG ghi nhận đã thu tiền', async () => {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'PENDING' },
            { shopId: shopA2, status: 'PENDING' },
          ],
          cod,
        );

        await buyer.post(buyerUrl(g.orderIds[0], 'cancel')).expect(200);
        await buyer.post(buyerUrl(g.orderIds[1], 'cancel')).expect(200);

        const payment = await paymentOf(g.groupId);
        expect(payment.status).toBe('PENDING');
        expect(payment.paidAt).toBeNull();
      });

      it('RACE: nhận đơn 1 và HỦY đơn 2 cùng nhóm ĐỒNG THỜI — dù thứ tự nào Payment cũng ra SUCCESS (không bên nào bỏ sót)', async () => {
        for (let round = 0; round < 6; round++) {
          const g = await seedGroup(
            [
              { shopId: shopA, status: 'SHIPPING' },
              { shopId: shopA2, status: 'PENDING' },
            ],
            cod,
          );

          const [receive, cancel] = await Promise.all([
            buyer.post(buyerUrl(g.orderIds[0], 'confirm-received')),
            buyer.post(buyerUrl(g.orderIds[1], 'cancel')),
          ]);

          expect([receive.status, cancel.status]).toEqual([200, 200]);
          expect(await statusOf(g.orderIds[0])).toBe('COMPLETED');
          expect(await statusOf(g.orderIds[1])).toBe('CANCELLED');
          expect((await paymentOf(g.groupId)).status).toBe('SUCCESS');
        }
      });
    });

    it('RACE: 2 đơn COD cùng nhóm được xác nhận nhận hàng ĐỒNG THỜI — vẫn thu tiền đúng 1 lần (không bên nào bỏ sót)', async () => {
      // Lặp nhiều nhóm để tăng xác suất 2 transaction thật sự chồng lên nhau.
      for (let round = 0; round < 5; round++) {
        const g = await seedGroup(
          [
            { shopId: shopA, status: 'SHIPPING' },
            { shopId: shopA2, status: 'SHIPPING' },
          ],
          cod,
        );

        const [r1, r2] = await Promise.all([
          buyer.post(buyerUrl(g.orderIds[0], 'confirm-received')),
          buyer.post(buyerUrl(g.orderIds[1], 'confirm-received')),
        ]);

        expect([r1.status, r2.status]).toEqual([200, 200]);
        const payment = await prisma.payment.findFirstOrThrow({
          where: { checkoutGroupId: g.groupId },
        });
        expect(payment.status).toBe('SUCCESS');
        for (const id of g.orderIds) {
          expect(await statusOf(id)).toBe('COMPLETED');
        }
      }
    });
  });

  describe('RACE: buyer hủy vs seller xác nhận cùng 1 đơn COD chờ xác nhận', () => {
    it('đúng 1 bên thắng, bên thua nhận 409; kho chỉ hoàn nếu bị hủy; timeline đúng 1 dòng chuyển', async () => {
      const LOSER_CODES = [
        'ORDER_ALREADY_CHANGED',
        'ORDER_INVALID_TRANSITION',
        'ORDER_CANCEL_NOT_ALLOWED',
      ];

      for (let round = 0; round < 6; round++) {
        const { orderId, variantId } = await seedOne('PENDING', cod);

        const [cancel, confirm] = await Promise.all([
          buyer.post(buyerUrl(orderId, 'cancel')),
          sellerA.post(sellerUrl(shopA, orderId, 'confirm')),
        ]);

        const statuses = [cancel.status, confirm.status].sort();
        expect(statuses).toEqual([200, 409]);
        const loser = cancel.status === 409 ? cancel : confirm;
        expect(LOSER_CODES).toContain(code(loser));

        const history = await historyOf(orderId);
        // mốc tạo (seed) + ĐÚNG 1 lần chuyển thật.
        expect(history).toHaveLength(2);
        const final = await statusOf(orderId);
        expect(final).toBe(history[1].toStatus);
        const stock = await stockOf(variantId);
        expect(stock.stock).toBe(final === 'CANCELLED' ? STOCK + QTY : STOCK);
      }
    });
  });
});
