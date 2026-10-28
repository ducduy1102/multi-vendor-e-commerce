import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
  type ShopStatus,
} from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE,
  adminCancelShopOrdersResultSchema,
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
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import { RefundService } from '../order/refund.service';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật + cổng thanh toán mock) cho "hủy hàng loạt đơn chưa giao của shop bị
// khoá" (Week11.md 4.1). Chứng minh điều unit test với mock không chứng minh được: chỉ shop ĐANG SUSPENDED mới bị hủy, chỉ đơn
// PENDING/CONFIRMED/PACKED CỦA SHOP ĐÓ bị chọn (SHIPPING/COMPLETED/CANCELLED/AWAITING_PAYMENT và đơn shop khác không bị đụng),
// kho cộng lại đúng, lượt voucher được trả, đơn online hoàn tiền về nguồn thanh toán còn đơn COD thì không có khoản hoàn, khoản
// hoàn bị cổng từ chối rơi vào needsManualRefund, chạy lại không hủy hai lần, lô tối đa 20 đơn, và hai dòng nhật ký quản trị.
// Chạy: `pnpm test:int`.
const TAG = 'it-admin-shop-orders-';
const PASSWORD = 'password123';
const REASON = 'Shop bị khoá do vi phạm, hủy các đơn chưa giao.';
const QTY = 2;
const PRICE = 100_000;
const STOCK = 10;
const URL = (shopId: string) =>
  `/api/v1/admin/shops/${shopId}/cancel-open-orders`;

const fakeMail = createFakeMail();

describe('Hủy hàng loạt đơn của shop bị khoá (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;

  const originalEnv = {
    mock: process.env.PAYMENT_MOCK_ENABLED,
    fail: process.env.PAYMENT_MOCK_REFUND_FAIL,
  };
  const observedStatuses = new Set<number>();

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  // Shop MỚI (đủ product) ở trạng thái `status`, kèm một product dùng chung cho mọi biến thể của shop.
  async function createShop(status: ShopStatus = 'SUSPENDED') {
    const base = await createShopWithProduct(prisma, TAG);
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { status },
    });
    return base;
  }
  type Base = Awaited<ReturnType<typeof createShop>>;

  interface SeedOrder {
    base: Base;
    status?: OrderStatus;
    method?: Extract<PaymentMethod, 'VNPAY' | 'COD'>;
    // Giảm giá từ voucher (> 0 ⇒ có VoucherUsage chưa trả).
    discount?: number;
    // Nhóm thanh toán đã có (đơn của shop khác trong CÙNG giao dịch); bỏ trống ⇒ nhóm mới có Payment riêng.
    groupId?: string;
  }

  async function seedOrder(input: SeedOrder) {
    const status = input.status ?? 'CONFIRMED';
    const method = input.method ?? 'VNPAY';
    const isCod = method === 'COD';
    const discount = input.discount ?? 0;
    const total = PRICE * QTY - discount;
    const buyer = await createUser(prisma, TAG);
    const group = input.groupId
      ? { id: input.groupId }
      : await createCheckoutGroup(prisma, buyer.id);
    const variant = await createVariant(prisma, input.base, { stock: STOCK });
    const voucher =
      discount > 0
        ? await prisma.voucher.create({
            data: {
              code: `${TAG.toUpperCase()}${stamp}${++seq}`,
              type: 'FIXED',
              value: discount,
              usedCount: 1,
            },
            select: { id: true },
          })
        : null;
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        shopId: input.base.shopId,
        checkoutGroupId: group.id,
        status,
        totalAmount: total,
        discountAmount: discount,
        voucherId: voucher?.id,
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
              priceAtPurchase: PRICE,
              productName: `${TAG}sp`,
              sku: `SKU-${stamp}-${++seq}`,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: { create: seedOrderHistory(status, { isCod }) },
      },
      select: { id: true },
    });
    let paymentId: string | null = null;
    if (!input.groupId) {
      const payment = await prisma.payment.create({
        data: {
          checkoutGroupId: group.id,
          method,
          status: isCod ? 'PENDING' : 'SUCCESS',
          amount: total,
          txnRef: `${TAG.toUpperCase()}${stamp}${++seq}`,
          transactionId: isCod ? null : `GW-${stamp}-${seq}`,
          expiresAt: null,
          paidAt: isCod ? null : new Date(Date.now() - 60_000),
        },
        select: { id: true },
      });
      paymentId = payment.id;
    }
    if (voucher) {
      await prisma.voucherUsage.create({
        data: {
          voucherId: voucher.id,
          userId: buyer.id,
          checkoutGroupId: group.id,
          discountAmount: discount,
        },
      });
    }
    return {
      orderId: order.id,
      buyerId: buyer.id,
      groupId: group.id,
      variantId: variant.id,
      paymentId,
      voucherId: voucher?.id ?? null,
      total,
    };
  }

  const stockOf = async (variantId: string) =>
    (
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      })
    ).stock;
  const statusOf = async (orderId: string) =>
    (
      await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true },
      })
    ).status;
  const refundsOf = (orderId: string) =>
    prisma.paymentRefund.findMany({
      where: { orderId },
      select: { id: true, status: true, amount: true, initiatedByType: true },
    });
  const auditRowsOf = (shopId: string) =>
    prisma.adminAuditLog.findMany({
      where: { targetType: 'SHOP', targetId: shopId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  async function cancel(
    agent: Agent,
    shopId: string,
    body: object = { reason: REASON },
  ) {
    const res = await agent
      .post(URL(shopId))
      .set('User-Agent', 'int-spec-agent')
      .send(body);
    observedStatuses.add(res.status);
    return res;
  }

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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): tránh ECONNRESET khi có request song song.
    await app.listen(0);

    const email = `${TAG}${stamp}admin@test.local`;
    await seedAdmin(prisma, { email, password: PASSWORD });
    admin = newAgent();
    await loginAs(admin, email);
    adminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;

    plainUser = newAgent();
    const userEmail = `${TAG}${stamp}user@test.local`;
    await plainUser
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password: PASSWORD, name: `${TAG}user` })
      .expect(201);
    await loginAs(plainUser, userEmail);
    anonymous = newAgent();
  });

  afterEach(() => {
    delete process.env.PAYMENT_MOCK_REFUND_FAIL;
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
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401, user thường 403 — và đơn của shop không bị đụng', async () => {
      const base = await createShop();
      const seeded = await seedOrder({ base });

      expect((await cancel(anonymous, base.shopId)).status).toBe(401);
      expect((await cancel(plainUser, base.shopId)).status).toBe(403);

      expect(await statusOf(seeded.orderId)).toBe('CONFIRMED');
      expect(await stockOf(seeded.variantId)).toBe(STOCK);
    });

    it('id sai dạng (UUID lạ, chuỗi rác, có NUL) và shop không tồn tại: cùng một 404, không 500', async () => {
      for (const id of [
        '00000000-0000-4000-8000-000000000000',
        'not-a-uuid',
        '..%2F..%2Fetc',
        `x%00y`,
      ]) {
        const res = await cancel(admin, id);
        expect([id, res.status]).toEqual([id, 404]);
      }
    });

    it.each(['APPROVED', 'PENDING', 'REJECTED'] as const)(
      'shop %s (không bị khoá): 409 SHOP_NOT_SUSPENDED, đơn nguyên vẹn, không có dòng nhật ký',
      async (status) => {
        const base = await createShop(status);
        const seeded = await seedOrder({ base });

        const res = await cancel(admin, base.shopId);

        expect(res.status).toBe(409);
        expect(code(res)).toBe('SHOP_NOT_SUSPENDED');
        expect(await statusOf(seeded.orderId)).toBe('CONFIRMED');
        expect(await stockOf(seeded.variantId)).toBe(STOCK);
        expect(await auditRowsOf(base.shopId)).toHaveLength(0);
      },
    );

    it.each([
      ['thiếu body', {}],
      ['lý do rỗng', { reason: '' }],
      ['lý do toàn khoảng trắng', { reason: '   ' }],
      ['lý do 501 ký tự', { reason: 'a'.repeat(501) }],
      ['lý do có ký tự điều khiển', { reason: 'a\u0000b' }],
      ['lý do không phải chuỗi', { reason: 42 }],
    ])('400 khi %s — không đơn nào bị hủy', async (_name, body) => {
      const base = await createShop();
      const seeded = await seedOrder({ base });

      const res = await cancel(admin, base.shopId, body);

      expect(res.status).toBe(400);
      expect(await statusOf(seeded.orderId)).toBe('CONFIRMED');
    });
  });

  describe('hủy đơn', () => {
    it('chỉ hủy PENDING/CONFIRMED/PACKED của shop bị khoá: kho cộng lại, voucher được trả, đơn online hoàn tiền, COD không có khoản hoàn, đơn khác trạng thái / shop khác nguyên vẹn', async () => {
      const shop = await createShop();
      const other = await createShop('APPROVED');
      const targets = {
        codPending: await seedOrder({
          base: shop,
          status: 'PENDING',
          method: 'COD',
        }),
        codConfirmed: await seedOrder({
          base: shop,
          status: 'CONFIRMED',
          method: 'COD',
        }),
        onlinePending: await seedOrder({ base: shop, status: 'PENDING' }),
        onlineConfirmed: await seedOrder({ base: shop, status: 'CONFIRMED' }),
        onlinePackedVoucher: await seedOrder({
          base: shop,
          status: 'PACKED',
          discount: 10_000,
        }),
      };
      const untouched = {
        shipping: await seedOrder({ base: shop, status: 'SHIPPING' }),
        completed: await seedOrder({ base: shop, status: 'COMPLETED' }),
        cancelled: await seedOrder({ base: shop, status: 'CANCELLED' }),
        awaitingPayment: await seedOrder({
          base: shop,
          status: 'AWAITING_PAYMENT',
        }),
        otherShopConfirmed: await seedOrder({
          base: other,
          status: 'CONFIRMED',
        }),
        otherShopPending: await seedOrder({
          base: other,
          status: 'PENDING',
          method: 'COD',
        }),
      };

      const res = await cancel(admin, shop.shopId);

      expect(res.status).toBe(200);
      const result = adminCancelShopOrdersResultSchema.parse(data(res));
      expect(result).toEqual({
        cancelled: 5,
        failed: [],
        needsManualRefund: [],
        refundsPending: 0,
        remaining: 0,
      });

      for (const t of Object.values(targets)) {
        expect(await statusOf(t.orderId)).toBe('CANCELLED');
        expect(await stockOf(t.variantId)).toBe(STOCK + QTY);
      }
      for (const [name, u] of Object.entries(untouched)) {
        const expected = {
          shipping: 'SHIPPING',
          completed: 'COMPLETED',
          cancelled: 'CANCELLED',
          awaitingPayment: 'AWAITING_PAYMENT',
          otherShopConfirmed: 'CONFIRMED',
          otherShopPending: 'PENDING',
        }[name];
        expect([name, await statusOf(u.orderId)]).toEqual([name, expected]);
        expect([name, await stockOf(u.variantId)]).toEqual([name, STOCK]);
        expect([name, await refundsOf(u.orderId)]).toEqual([name, []]);
      }

      // Đơn COD: không có tiền đi qua cổng nên không có khoản hoàn. Đơn online: đúng một khoản hoàn, do ADMIN khởi tạo.
      expect(await refundsOf(targets.codPending.orderId)).toEqual([]);
      expect(await refundsOf(targets.codConfirmed.orderId)).toEqual([]);
      for (const key of [
        'onlinePending',
        'onlineConfirmed',
        'onlinePackedVoucher',
      ] as const) {
        const refunds = await refundsOf(targets[key].orderId);
        expect(refunds).toHaveLength(1);
        expect(refunds[0]).toMatchObject({
          status: 'SUCCEEDED',
          initiatedByType: 'ADMIN',
        });
        expect(Number(refunds[0].amount)).toBe(targets[key].total);
        const payment = await prisma.payment.findUniqueOrThrow({
          where: { id: targets[key].paymentId as string },
          select: { status: true, refundedAmount: true },
        });
        expect(payment.status).toBe('REFUNDED');
        expect(Number(payment.refundedAmount)).toBe(targets[key].total);
      }

      // Voucher: nhóm chỉ có đơn đã hủy ⇒ lượt dùng được trả.
      const usage = await prisma.voucherUsage.findFirstOrThrow({
        where: { checkoutGroupId: targets.onlinePackedVoucher.groupId },
        select: { releasedAt: true },
      });
      expect(usage.releasedAt).not.toBeNull();
      const voucher = await prisma.voucher.findUniqueOrThrow({
        where: { id: targets.onlinePackedVoucher.voucherId as string },
        select: { usedCount: true },
      });
      expect(voucher.usedCount).toBe(0);

      // Dòng thời gian của đơn: ADMIN hủy, kèm đúng lý do.
      const history = await prisma.orderStatusHistory.findFirstOrThrow({
        where: {
          orderId: targets.onlineConfirmed.orderId,
          toStatus: 'CANCELLED',
        },
        select: { actorType: true, actorId: true, note: true },
      });
      expect(history).toEqual({
        actorType: 'ADMIN',
        actorId: adminId,
        note: REASON,
      });

      // Người mua của mỗi đơn đã hủy nhận một email; người mua đơn không bị hủy thì không.
      const recipients = fakeMail.sent.map((m) => m.to);
      expect(recipients).toHaveLength(5);
      const buyerEmail = async (buyerId: string) =>
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: buyerId },
            select: { email: true },
          })
        ).email;
      for (const t of Object.values(targets)) {
        expect(recipients).toContain(await buyerEmail(t.buyerId));
      }
      expect(recipients).not.toContain(
        await buyerEmail(untouched.shipping.buyerId),
      );
    });

    it('chạy lại: không hủy hai lần, không thêm khoản hoàn, không cộng kho lần nữa, không ghi thêm nhật ký', async () => {
      const shop = await createShop();
      const a = await seedOrder({ base: shop, status: 'CONFIRMED' });
      const b = await seedOrder({
        base: shop,
        status: 'PENDING',
        method: 'COD',
      });

      const first = adminCancelShopOrdersResultSchema.parse(
        data(await cancel(admin, shop.shopId)),
      );
      const auditAfterFirst = (await auditRowsOf(shop.shopId)).length;
      const second = await cancel(admin, shop.shopId);

      expect(first.cancelled).toBe(2);
      expect(second.status).toBe(200);
      expect(data(second)).toEqual({
        cancelled: 0,
        failed: [],
        needsManualRefund: [],
        refundsPending: 0,
        remaining: 0,
      });
      expect(await refundsOf(a.orderId)).toHaveLength(1);
      expect(await stockOf(a.variantId)).toBe(STOCK + QTY);
      expect(await stockOf(b.variantId)).toBe(STOCK + QTY);
      expect(await auditRowsOf(shop.shopId)).toHaveLength(auditAfterFirst);
    });

    it('một lô tối đa 20 đơn (cũ nhất trước): lần đầu hủy 20, remaining 2; gọi lại hủy nốt 2 đơn còn lại', async () => {
      const shop = await createShop();
      const total = ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE + 2;
      const seeded: Awaited<ReturnType<typeof seedOrder>>[] = [];
      for (let i = 0; i < total; i += 1) {
        seeded.push(
          await seedOrder({ base: shop, status: 'PENDING', method: 'COD' }),
        );
      }

      const first = adminCancelShopOrdersResultSchema.parse(
        data(await cancel(admin, shop.shopId)),
      );
      expect(first).toMatchObject({
        cancelled: ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE,
        remaining: 2,
      });
      const cancelledAfterFirst = (
        await Promise.all(seeded.map((s) => statusOf(s.orderId)))
      ).filter((s) => s === 'CANCELLED').length;
      expect(cancelledAfterFirst).toBe(ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE);

      const second = adminCancelShopOrdersResultSchema.parse(
        data(await cancel(admin, shop.shopId)),
      );
      expect(second).toMatchObject({ cancelled: 2, remaining: 0 });
      expect(
        (await Promise.all(seeded.map((s) => statusOf(s.orderId)))).every(
          (s) => s === 'CANCELLED',
        ),
      ).toBe(true);
    }, 60_000);

    it('đơn của shop khác trong CÙNG giao dịch thanh toán không bị đụng: chỉ hoàn phần tiền của đơn đã hủy, Payment vẫn SUCCESS (hoàn một phần)', async () => {
      const shop = await createShop();
      const other = await createShop('APPROVED');
      const mine = await seedOrder({ base: shop, status: 'CONFIRMED' });
      // Đơn của shop khác nằm trong cùng nhóm/giao dịch với đơn của shop bị khoá.
      const theirs = await seedOrder({
        base: other,
        status: 'CONFIRMED',
        groupId: mine.groupId,
      });
      await prisma.payment.update({
        where: { id: mine.paymentId as string },
        data: { amount: mine.total + theirs.total },
      });

      const res = await cancel(admin, shop.shopId);

      expect(adminCancelShopOrdersResultSchema.parse(data(res))).toMatchObject({
        cancelled: 1,
        failed: [],
        needsManualRefund: [],
      });
      expect(await statusOf(mine.orderId)).toBe('CANCELLED');
      expect(await statusOf(theirs.orderId)).toBe('CONFIRMED');
      expect(await stockOf(theirs.variantId)).toBe(STOCK);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: mine.paymentId as string },
        select: { status: true, refundedAmount: true },
      });
      expect(payment.status).toBe('SUCCESS');
      expect(Number(payment.refundedAmount)).toBe(mine.total);
    });
  });

  describe('khoản hoàn qua cổng không thành công', () => {
    it('cổng từ chối hoàn (FAILED): đơn VẪN hủy (kho, trạng thái đúng), khoản hoàn FAILED nằm ở needsManualRefund để Admin xử lý ở màn hoàn tiền', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const shop = await createShop();
      const seeded = await seedOrder({ base: shop, status: 'CONFIRMED' });

      const res = await cancel(admin, shop.shopId);

      const result = adminCancelShopOrdersResultSchema.parse(data(res));
      const [refund] = await refundsOf(seeded.orderId);
      expect(refund.status).toBe('FAILED');
      expect(result).toMatchObject({
        cancelled: 1,
        failed: [],
        refundsPending: 0,
        remaining: 0,
      });
      expect(result.needsManualRefund).toEqual([
        {
          orderId: seeded.orderId,
          refundId: refund.id,
          amount: String(seeded.total),
        },
      ]);
      expect(await statusOf(seeded.orderId)).toBe('CANCELLED');
      expect(await stockOf(seeded.variantId)).toBe(STOCK + QTY);

      // Khoản hoàn hiện ở màn hoàn tiền của Admin (tab "cần xử lý") — đúng chỗ Admin được dẫn tới.
      const list = await admin
        .get('/api/v1/admin/refunds')
        .query({ status: 'NEEDS_ACTION', limit: 50 });
      const ids = ((data(list) as { items: { id: string }[] }).items ?? []).map(
        (i) => i.id,
      );
      expect(ids).toContain(refund.id);
    });

    it('cổng chưa trả lời (PENDING): chỉ đếm vào refundsPending, không bắt Admin hoàn tay (job tự thử lại)', async () => {
      jest.spyOn(MockPaymentProvider.prototype, 'refund').mockResolvedValue({
        outcome: 'PENDING',
        gatewayRef: null,
        failureReason: null,
      });
      const shop = await createShop();
      const seeded = await seedOrder({ base: shop, status: 'PACKED' });

      const res = await cancel(admin, shop.shopId);

      expect(adminCancelShopOrdersResultSchema.parse(data(res))).toMatchObject({
        cancelled: 1,
        needsManualRefund: [],
        refundsPending: 1,
      });
      expect((await refundsOf(seeded.orderId))[0].status).toBe('PENDING');
      expect(await statusOf(seeded.orderId)).toBe('CANCELLED');
    });

    it('một đơn lỗi không chặn các đơn còn lại: đơn đổi trạng thái giữa chừng (đã giao) vào failed với mã nghiệp vụ, đơn kia vẫn hủy', async () => {
      const shop = await createShop();
      const racing = await seedOrder({
        base: shop,
        status: 'PENDING',
        method: 'COD',
      });
      const normal = await seedOrder({
        base: shop,
        status: 'CONFIRMED',
        method: 'COD',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const original = RefundService.prototype.cancelOrderWithRefund;
      jest
        .spyOn(RefundService.prototype, 'cancelOrderWithRefund')
        .mockImplementation(async function (
          this: RefundService,
          actor,
          orderId,
          options,
        ) {
          // Seller giao đơn NGAY TRƯỚC khi Admin hủy tới đơn này.
          if (orderId === racing.orderId) {
            await prisma.order.update({
              where: { id: orderId },
              data: { status: 'SHIPPING' },
            });
          }
          return Reflect.apply(original, this, [actor, orderId, options]);
        });

      const res = await cancel(admin, shop.shopId);

      const result = adminCancelShopOrdersResultSchema.parse(data(res));
      expect(result.cancelled).toBe(1);
      expect(result.failed).toEqual([
        { orderId: racing.orderId, code: 'ORDER_INVALID_TRANSITION' },
      ]);
      expect(await statusOf(racing.orderId)).toBe('SHIPPING');
      expect(await statusOf(normal.orderId)).toBe('CANCELLED');
      // Đơn đã giao không còn là "chưa giao" nên không tính vào remaining.
      expect(result.remaining).toBe(0);
    });

    it('Admin khác mở lại shop giữa chừng: dừng ngay, các đơn còn lại không bị hủy', async () => {
      const shop = await createShop();
      const first = await seedOrder({
        base: shop,
        status: 'PENDING',
        method: 'COD',
      });
      const second = await seedOrder({
        base: shop,
        status: 'PENDING',
        method: 'COD',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const original = RefundService.prototype.cancelOrderWithRefund;
      let calls = 0;
      jest
        .spyOn(RefundService.prototype, 'cancelOrderWithRefund')
        .mockImplementation(async function (
          this: RefundService,
          actor,
          orderId,
          options,
        ) {
          const out = await Reflect.apply(original, this, [
            actor,
            orderId,
            options,
          ]);
          calls += 1;
          if (calls === 1) {
            await prisma.shop.update({
              where: { id: shop.shopId },
              data: { status: 'APPROVED' },
            });
          }
          return out;
        });

      const res = await cancel(admin, shop.shopId);

      const result = adminCancelShopOrdersResultSchema.parse(data(res));
      expect(result).toMatchObject({ cancelled: 1, remaining: 1 });
      const statuses = [
        await statusOf(first.orderId),
        await statusOf(second.orderId),
      ];
      expect(statuses.sort()).toEqual(['CANCELLED', 'PENDING']);
    });
  });

  describe('nhật ký quản trị', () => {
    it('hai dòng CANCEL_SHOP_OPEN_ORDERS: STARTED (trước khi hủy) rồi FINISHED kèm số đếm, đúng người, lý do, IP; meta không chứa chữ tự do', async () => {
      process.env.PAYMENT_MOCK_REFUND_FAIL = 'true';
      const shop = await createShop();
      await seedOrder({ base: shop, status: 'CONFIRMED' });
      await seedOrder({ base: shop, status: 'PENDING', method: 'COD' });

      await cancel(admin, shop.shopId);

      const rows = await auditRowsOf(shop.shopId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          actorId: adminId,
          action: 'CANCEL_SHOP_OPEN_ORDERS',
          targetType: 'SHOP',
          targetId: shop.shopId,
          reason: REASON,
          ip: '127.0.0.1',
        });
        expect(row.userAgent).toBe('int-spec-agent');
      }
      expect(rows[0].meta).toEqual({ phase: 'STARTED', matched: 2 });
      expect(rows[1].meta).toEqual({
        phase: 'FINISHED',
        matched: 2,
        cancelled: 2,
        failed: 0,
        needsManualRefund: 1,
        refundsPending: 0,
      });
      expect(rows[0].createdAt.getTime()).toBeLessThanOrEqual(
        rows[1].createdAt.getTime(),
      );
    });

    it('không ghi được dòng nhật ký đầu ⇒ KHÔNG hủy đơn nào (fail-closed)', async () => {
      const shop = await createShop();
      const seeded = await seedOrder({ base: shop, status: 'CONFIRMED' });
      jest
        .spyOn(AdminAuditService.prototype, 'record')
        .mockRejectedValue(new Error('audit down'));

      const res = await cancel(admin, shop.shopId);

      expect(res.status).toBe(500);
      expect(await statusOf(seeded.orderId)).toBe('CONFIRMED');
      expect(await stockOf(seeded.variantId)).toBe(STOCK);
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: route có tài liệu, khai báo đúng 200 và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin').setVersion('0').build(),
      );
      const operation = (
        document.paths['/api/v1/admin/shops/{id}/cancel-open-orders'] as
          Record<string, { responses: Record<string, unknown> }> | undefined
      )?.post;

      expect(operation).toBeDefined();
      const documented = Object.keys(operation?.responses ?? {}).map(Number);
      expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
      // 500 chỉ do test cố ý phá nhật ký, không phải hành vi cần tài liệu.
      for (const status of [...observedStatuses].filter((s) => s !== 500)) {
        expect(documented).toContain(status);
      }
      expect([...observedStatuses].filter((s) => s !== 500).sort()).toEqual([
        200, 400, 401, 403, 404, 409,
      ]);
    });
  });
});
