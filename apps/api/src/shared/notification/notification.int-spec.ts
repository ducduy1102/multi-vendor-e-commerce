import { Logger } from '@nestjs/common';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import { notificationSchema } from '@ecommerce/types';
import { randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import {
  cleanupByTag,
  createCheckoutGroup,
  createOrderWithItem,
  createShopWithProduct,
  createUser,
  createVariant,
  seedOrderHistory,
} from '../testing/db-fixtures';
import { createFakeRealtimeEmitter } from '../testing/fake-realtime-emitter';
import { NotificationFactsLoader } from './notification-facts.loader';
import { NotificationService } from './notification.service';

// Integration test trên Postgres THẬT cho bên ghi thông báo (Week10.md 7.3): truy vấn của bộ tải dữ kiện (ai là người
// mua / chủ shop / Admin của từng bản ghi, đơn nào shop đã từng thấy) và việc ghi thật + đẩy real-time. Quyết định "ai
// nhận gì" được kiểm riêng bằng bảng ở notification-events.spec.ts; ở đây chứng minh dữ kiện lấy từ DB là ĐÚNG.
// Chạy: `pnpm test:int`.
const TAG = 'it-notif-';

describe('NotificationService + NotificationFactsLoader (DB thật)', () => {
  const prisma = new PrismaClient();
  const realtime = createFakeRealtimeEmitter();
  const service = new NotificationService(
    prisma as unknown as PrismaService,
    new NotificationFactsLoader(prisma as unknown as PrismaService),
    realtime,
  );
  const startedAt = new Date(Date.now() - 1000);

  let buyerId: string;
  let strangerId: string;
  let ownerA: string;
  let ownerB: string;
  let shopA: string;
  let shopB: string;
  let productA: string;
  let variantA: string;
  let variantB: string;
  let activeAdminId: string;
  let suspendedAdminId: string;
  let shopAName: string;

  const idsOf = (rows: { userId: string }[]) =>
    rows.map((r) => r.userId).sort();
  const forOrder = (orderId: string, type?: string) =>
    prisma.notification.findMany({
      where: {
        data: { path: ['orderId'], equals: orderId },
        ...(type ? { type } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  async function addOrder(
    groupId: string,
    input: {
      shopId: string;
      variantId: string;
      status: OrderStatus;
      isCod: boolean;
    },
  ) {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: input.variantId },
      select: { sku: true, price: true },
    });
    return prisma.order.create({
      data: {
        userId: buyerId,
        shopId: input.shopId,
        checkoutGroupId: groupId,
        status: input.status,
        totalAmount: variant.price,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: input.variantId,
              quantity: 1,
              priceAtPurchase: variant.price,
              productName: 'sp',
              sku: variant.sku,
              variantLabel: null,
              imageUrl: null,
            },
          ],
        },
        statusHistory: {
          create: seedOrderHistory(input.status, { isCod: input.isCod }),
        },
      },
      select: { id: true },
    });
  }

  // Đơn online CHƯA TỪNG được thanh toán rồi bị hủy (AWAITING_PAYMENT → CANCELLED): shop chưa bao giờ thấy.
  async function neverPaidCancelledOrder() {
    const group = await createCheckoutGroup(prisma, buyerId);
    return addOrder(group.id, {
      shopId: shopA,
      variantId: variantA,
      status: 'CANCELLED',
      isCod: false,
    });
  }

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const a = await createShopWithProduct(prisma, TAG);
    const b = await createShopWithProduct(prisma, TAG);
    shopA = a.shopId;
    shopB = b.shopId;
    ownerA = a.ownerId;
    ownerB = b.ownerId;
    productA = a.productId;
    variantA = (await createVariant(prisma, a, { stock: 50 })).id;
    variantB = (await createVariant(prisma, b, { stock: 50 })).id;
    buyerId = (await createUser(prisma, TAG)).id;
    strangerId = (await createUser(prisma, TAG)).id;
    shopAName = (
      await prisma.shop.findUniqueOrThrow({
        where: { id: shopA },
        select: { name: true },
      })
    ).name;
    const makeAdmin = (accountStatus: 'ACTIVE' | 'SUSPENDED') =>
      prisma.user.create({
        data: {
          email: `${TAG}admin-${accountStatus}-${randomUUID()}@test.local`,
          name: `${TAG}admin`,
          role: 'ADMIN',
          accountStatus,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
    activeAdminId = (await makeAdmin('ACTIVE')).id;
    suspendedAdminId = (await makeAdmin('SUSPENDED')).id;
  });

  beforeEach(async () => {
    realtime.reset();
    // Dọn cả thông báo gửi tới Admin THẬT của DB dev (xem afterAll) để mỗi test thấy một hộp thư sạch.
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { user: { email: { startsWith: TAG } } },
          { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
        ],
      },
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Thông báo gửi tới Admin THẬT của DB dev (không mang tiền tố test) cũng phải dọn: chỉ xoá những hàng sinh ra từ lúc
    // spec này bắt đầu.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('đơn', () => {
    it('ORDERS_PLACED: chỉ chủ shop của đơn ĐÃ vào PENDING được báo; đơn chưa thanh toán trong cùng nhóm thì không', async () => {
      const group = await createCheckoutGroup(prisma, buyerId);
      const paid = await addOrder(group.id, {
        shopId: shopA,
        variantId: variantA,
        status: 'PENDING',
        isCod: true,
      });
      const unpaid = await addOrder(group.id, {
        shopId: shopB,
        variantId: variantB,
        status: 'AWAITING_PAYMENT',
        isCod: false,
      });

      await service.notify({
        kind: 'ORDERS_PLACED',
        checkoutGroupId: group.id,
      });

      const rows = await prisma.notification.findMany({
        where: { userId: { in: [ownerA, ownerB, buyerId, strangerId] } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: ownerA,
        type: 'ORDER_NEW',
        readAt: null,
      });
      expect(rows[0].data).toEqual({ orderId: paid.id });
      expect(await forOrder(unpaid.id)).toEqual([]);
      expect(realtime.emitted.map((e) => e.userId)).toEqual([ownerA]);
      // Bộ tải dữ kiện CŨNG tự lọc (không chỉ hàm dựng thông báo): hai lớp độc lập, bỏ một lớp thì lớp kia vẫn che — nên
      // phải kiểm riêng từng lớp thì mới thấy được nếu một lớp bị gỡ.
      const loaded = await new NotificationFactsLoader(
        prisma as unknown as PrismaService,
      ).load({ kind: 'ORDERS_PLACED', checkoutGroupId: group.id });
      expect(loaded).toEqual({
        kind: 'ORDERS',
        orders: [expect.objectContaining({ orderId: paid.id })],
      });
    });

    it('ORDER_CONFIRMED / ORDER_SHIPPED / ORDER_AUTO_COMPLETED: người mua của đơn nhận, kèm TÊN SHOP lấy từ DB; không ai khác', async () => {
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyerId,
        shopId: shopA,
        variantId: variantA,
        status: 'SHIPPING',
      });

      await service.notify({ kind: 'ORDER_CONFIRMED', orderId });
      await service.notify({ kind: 'ORDER_SHIPPED', orderId });
      await service.notify({ kind: 'ORDER_AUTO_COMPLETED', orderId });

      const rows = await forOrder(orderId);
      expect(rows.map((r) => r.type)).toEqual([
        'ORDER_CONFIRMED',
        'ORDER_SHIPPED',
        'ORDER_COMPLETED',
      ]);
      expect(idsOf(rows)).toEqual([buyerId, buyerId, buyerId].sort());
      for (const row of rows)
        expect(row.data).toEqual({ orderId, shopName: shopAName });
      expect(realtime.emitted.every((e) => e.userId === buyerId)).toBe(true);
    });

    it('REFUND_COMPLETED: người mua nhận, chủ shop không', async () => {
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyerId,
        shopId: shopA,
        variantId: variantA,
        status: 'COMPLETED',
      });

      await service.notify({ kind: 'REFUND_COMPLETED', orderId });

      expect(idsOf(await forOrder(orderId))).toEqual([buyerId]);
    });

    describe('ORDERS_CANCELLED', () => {
      it('theo danh sách đơn: người mua nhận mỗi đơn ĐÃ hủy; chủ shop CHỈ nhận đơn shop từng thấy; đơn chưa hủy bị bỏ qua', async () => {
        const seen = await createOrderWithItem(prisma, {
          userId: buyerId,
          shopId: shopA,
          variantId: variantA,
          status: 'CANCELLED',
        });
        const neverSeen = await neverPaidCancelledOrder();
        const stillPending = await createOrderWithItem(prisma, {
          userId: buyerId,
          shopId: shopA,
          variantId: variantA,
          status: 'PENDING',
        });

        await service.notify({
          kind: 'ORDERS_CANCELLED',
          target: {
            orderIds: [seen.orderId, neverSeen.id, stillPending.orderId],
          },
          by: 'BUYER',
          reason: 'Đổi ý',
        });

        const seenRows = await forOrder(seen.orderId);
        expect(idsOf(seenRows)).toEqual([buyerId, ownerA].sort());
        expect(seenRows.find((r) => r.userId === ownerA)?.data).toMatchObject({
          audience: 'SELLER',
          by: 'BUYER',
          reason: 'Đổi ý',
        });
        expect(seenRows.find((r) => r.userId === buyerId)?.data).toMatchObject({
          audience: 'BUYER',
        });
        // Đơn chưa từng được thanh toán: chỉ người mua biết; chủ shop KHÔNG được lộ.
        expect(idsOf(await forOrder(neverSeen.id))).toEqual([buyerId]);
        // Đơn chưa hủy: không ai nhận.
        expect(await forOrder(stillPending.orderId)).toEqual([]);
      });

      it('theo nhóm thanh toán: chỉ lấy các đơn ĐÃ CANCELLED của nhóm', async () => {
        const group = await createCheckoutGroup(prisma, buyerId);
        const cancelled = await addOrder(group.id, {
          shopId: shopA,
          variantId: variantA,
          status: 'CANCELLED',
          isCod: false,
        });
        const alive = await addOrder(group.id, {
          shopId: shopB,
          variantId: variantB,
          status: 'AWAITING_PAYMENT',
          isCod: false,
        });

        await service.notify({
          kind: 'ORDERS_CANCELLED',
          target: { checkoutGroupId: group.id },
          by: 'SYSTEM',
        });

        expect(idsOf(await forOrder(cancelled.id))).toEqual([buyerId]);
        expect(await forOrder(alive.id)).toEqual([]);
      });

      it('người mua của đơn là người trong DB, không phải ai khác: người lạ không nhận gì', async () => {
        const { orderId } = await createOrderWithItem(prisma, {
          userId: buyerId,
          shopId: shopA,
          variantId: variantA,
          status: 'CANCELLED',
        });

        await service.notify({
          kind: 'ORDERS_CANCELLED',
          target: { orderIds: [orderId] },
          by: 'SELLER',
        });

        expect(
          await prisma.notification.count({ where: { userId: strangerId } }),
        ).toBe(0);
        expect(idsOf(await forOrder(orderId))).toEqual([buyerId]);
      });
    });
  });

  describe('yêu cầu hủy / trả hàng', () => {
    let orderId: string;
    let requestId: string;

    beforeAll(async () => {
      orderId = (
        await createOrderWithItem(prisma, {
          userId: buyerId,
          shopId: shopA,
          variantId: variantA,
          status: 'COMPLETED',
        })
      ).orderId;
      requestId = (
        await prisma.refundRequest.create({
          data: {
            orderId,
            shopId: shopA,
            userId: buyerId,
            kind: 'RETURN',
            reasonCode: 'DAMAGED',
            sellerRespondBy: new Date(Date.now() + 86_400_000),
          },
          select: { id: true },
        })
      ).id;
    });

    it('REFUND_REQUEST_CREATED: chỉ chủ shop của đơn nhận', async () => {
      await service.notify({
        kind: 'REFUND_REQUEST_CREATED',
        refundRequestId: requestId,
      });

      const rows = await forOrder(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: ownerA,
        type: 'REFUND_REQUEST_NEW',
      });
      expect(rows[0].data).toEqual({ orderId, kind: 'RETURN' });
    });

    it('REFUND_REQUEST_APPROVED / REJECTED: chỉ người mua nhận; lý do từ chối đi theo', async () => {
      await service.notify({
        kind: 'REFUND_REQUEST_APPROVED',
        refundRequestId: requestId,
      });
      await service.notify({
        kind: 'REFUND_REQUEST_REJECTED',
        refundRequestId: requestId,
        reason: 'Không đủ điều kiện',
      });

      const rows = await forOrder(orderId);
      expect(rows.map((r) => [r.userId, r.type])).toEqual([
        [buyerId, 'REFUND_REQUEST_APPROVED'],
        [buyerId, 'REFUND_REQUEST_REJECTED'],
      ]);
      expect(rows[1].data).toEqual({
        orderId,
        kind: 'RETURN',
        reason: 'Không đủ điều kiện',
      });
    });

    it('REFUND_REQUEST_ESCALATED: MỌI Admin đang hoạt động (và chỉ họ) + chủ shop; Admin bị khoá thì không', async () => {
      const activeAdmins = (
        await prisma.user.findMany({
          where: { role: 'ADMIN', accountStatus: 'ACTIVE' },
          select: { id: true },
        })
      ).map((u) => u.id);
      expect(activeAdmins).toContain(activeAdminId);
      expect(activeAdmins).not.toContain(suspendedAdminId);

      await service.notify({
        kind: 'REFUND_REQUEST_ESCALATED',
        refundRequestId: requestId,
      });

      const rows = await forOrder(orderId, 'REFUND_REQUEST_ESCALATED');
      const toAdmins = rows.filter(
        (r) => (r.data as { audience: string }).audience === 'ADMIN',
      );
      const toShop = rows.filter(
        (r) => (r.data as { audience: string }).audience === 'SELLER',
      );
      expect(idsOf(toAdmins)).toEqual([...activeAdmins].sort());
      expect(idsOf(toShop)).toEqual([ownerA]);
      expect(
        rows.some((r) => r.userId === suspendedAdminId || r.userId === buyerId),
      ).toBe(false);
    });

    it('REFUND_REQUEST_DECIDED_BY_ADMIN: chỉ chủ shop nhận', async () => {
      await service.notify({
        kind: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
        refundRequestId: requestId,
        outcome: 'REJECTED',
      });

      const rows = await forOrder(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: ownerA,
        type: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
      });
      expect(rows[0].data).toEqual({
        orderId,
        kind: 'RETURN',
        outcome: 'REJECTED',
      });
    });
  });

  describe('đánh giá', () => {
    it('REVIEW_CREATED → chủ shop; REVIEW_REPLIED → tác giả đánh giá (không phải chủ shop)', async () => {
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyerId,
        shopId: shopA,
        variantId: variantA,
        status: 'COMPLETED',
      });
      const created = await prisma.review.create({
        data: { userId: buyerId, productId: productA, orderId, rating: 4 },
        select: { id: true },
      });
      const productName = (
        await prisma.product.findUniqueOrThrow({
          where: { id: productA },
          select: { name: true },
        })
      ).name;

      await service.notify({ kind: 'REVIEW_CREATED', reviewId: created.id });
      await service.notify({ kind: 'REVIEW_REPLIED', reviewId: created.id });

      const rows = await prisma.notification.findMany({
        where: { data: { path: ['productId'], equals: productA } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(rows.map((r) => [r.userId, r.type])).toEqual([
        [ownerA, 'REVIEW_NEW'],
        [buyerId, 'REVIEW_REPLIED'],
      ]);
      expect(rows[0].data).toEqual({
        productId: productA,
        productName,
        rating: 4,
      });
      expect(rows[1].data).toEqual({
        productId: productA,
        productName,
        shopName: shopAName,
      });
    });
  });

  describe('shop', () => {
    it('SHOP_STATUS_CHANGED: chỉ chủ shop nhận, kèm trạng thái và lý do', async () => {
      await service.notify({
        kind: 'SHOP_STATUS_CHANGED',
        shopId: shopB,
        status: 'SUSPENDED',
        reason: 'Vi phạm',
      });

      const rows = await prisma.notification.findMany({
        where: { data: { path: ['shopId'], equals: shopB } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: ownerB,
        type: 'SHOP_STATUS_CHANGED',
      });
      expect(rows[0].data).toEqual({
        shopId: shopB,
        status: 'SUSPENDED',
        reason: 'Vi phạm',
      });
    });

    it('SHOP_SUBMITTED: mọi Admin đang hoạt động nhận, chủ shop thì không', async () => {
      const activeAdmins = (
        await prisma.user.findMany({
          where: { role: 'ADMIN', accountStatus: 'ACTIVE' },
          select: { id: true },
        })
      ).map((u) => u.id);

      await service.notify({ kind: 'SHOP_SUBMITTED', shopId: shopA });

      const rows = await prisma.notification.findMany({
        where: { data: { path: ['shopId'], equals: shopA } },
      });
      expect(idsOf(rows)).toEqual([...activeAdmins].sort());
      expect(rows.every((r) => r.type === 'ADMIN_SHOP_PENDING')).toBe(true);
      expect(
        rows.some((r) => r.userId === ownerA || r.userId === suspendedAdminId),
      ).toBe(false);
    });
  });

  describe('hàng đã ghi', () => {
    it('đọc lại qua schema ĐỌC cho ra đúng loại đã biết (không rơi về UNKNOWN) và trùng payload đã đẩy', async () => {
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyerId,
        shopId: shopA,
        variantId: variantA,
        status: 'SHIPPING',
      });

      await service.notify({ kind: 'ORDER_SHIPPED', orderId });

      const [row] = await forOrder(orderId);
      const parsed = notificationSchema.parse({
        id: row.id,
        type: row.type,
        data: row.data,
        readAt: null,
        createdAt: row.createdAt.toISOString(),
      });
      expect(parsed.type).toBe('ORDER_SHIPPED');
      expect(realtime.emitted).toHaveLength(1);
      expect(realtime.emitted[0].payload).toEqual(parsed);
      expect(realtime.emitted[0].userId).toBe(row.userId);
    });

    it('hàng chưa đọc, có mốc tạo; ghi nhiều người nhận trong MỘT câu lệnh cùng mốc', async () => {
      const group = await createCheckoutGroup(prisma, buyerId);
      await addOrder(group.id, {
        shopId: shopA,
        variantId: variantA,
        status: 'PENDING',
        isCod: true,
      });
      await addOrder(group.id, {
        shopId: shopB,
        variantId: variantB,
        status: 'PENDING',
        isCod: true,
      });

      await service.notify({
        kind: 'ORDERS_PLACED',
        checkoutGroupId: group.id,
      });

      const rows = await prisma.notification.findMany({
        where: { userId: { in: [ownerA, ownerB] } },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.readAt === null)).toBe(true);
      expect(new Set(rows.map((r) => r.createdAt.getTime())).size).toBe(1);
    });
  });

  describe('không có gì để báo', () => {
    it('bản ghi nguồn không tồn tại ⇒ không ghi, không đẩy, không ném', async () => {
      await expect(
        service.notify({ kind: 'ORDER_CONFIRMED', orderId: randomUUID() }),
      ).resolves.toBeUndefined();
      await expect(
        service.notify({ kind: 'REVIEW_CREATED', reviewId: randomUUID() }),
      ).resolves.toBeUndefined();
      await expect(
        service.notify({
          kind: 'REFUND_REQUEST_CREATED',
          refundRequestId: randomUUID(),
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.notify({ kind: 'SHOP_SUBMITTED', shopId: randomUUID() }),
      ).resolves.toBeUndefined();

      expect(realtime.emitted).toEqual([]);
      expect(
        await prisma.notification.count({
          where: { user: { email: { startsWith: TAG } } },
        }),
      ).toBe(0);
    });

    it('id không phải UUID (client độc hại / lỗi lập trình) ⇒ không ném, không ghi gì', async () => {
      await expect(
        service.notify({
          kind: 'ORDER_CONFIRMED',
          orderId: "'; DROP TABLE notifications; --",
        }),
      ).resolves.toBeUndefined();

      expect(realtime.emitted).toEqual([]);
    });
  });
});
