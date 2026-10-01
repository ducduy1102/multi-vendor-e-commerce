import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { OrderQueryService } from './order-query.service';

const D = (value: number) => new Prisma.Decimal(value);

function loadedItem(n: number, quantity = 1, price = 100_000) {
  return {
    productName: `Sản phẩm ${n}`,
    variantLabel: n % 2 === 0 ? null : 'Đỏ / M',
    sku: `SKU-${n}`,
    imageUrl: null,
    quantity,
    priceAtPurchase: D(price),
  };
}

function loadedOrder(overrides: Record<string, unknown> = {}) {
  const items = [loadedItem(1), loadedItem(2)];
  return {
    id: 'o1',
    checkoutGroupId: 'g1',
    status: 'AWAITING_PAYMENT',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    totalAmount: D(220_000),
    shop: { id: 's1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
    items,
    _count: { items: items.length },
    checkoutGroup: {
      createdAt: new Date(),
      payments: [
        {
          method: 'VNPAY',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 10 * 60_000),
          createdAt: new Date(),
        },
      ],
    },
    ...overrides,
  };
}

function loadedDetail(overrides: Record<string, unknown> = {}) {
  return loadedOrder({
    recipientName: 'Nguyễn Văn A',
    recipientPhone: '0912345678',
    shippingAddressLine: '12 Nguyễn Huệ',
    shippingWard: 'Phường Bến Nghé',
    shippingProvince: 'Hồ Chí Minh',
    discountAmount: D(0),
    shippingFee: D(20_000),
    carrier: null,
    trackingCode: null,
    statusHistory: [
      {
        fromStatus: null,
        toStatus: 'AWAITING_PAYMENT',
        actorType: 'BUYER',
        note: null,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ],
    ...overrides,
  });
}

describe('OrderQueryService (buyer)', () => {
  let service: OrderQueryService;
  let prisma: {
    order: { count: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      order: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new OrderQueryService(prisma as unknown as PrismaService);
  });

  describe('listForBuyer', () => {
    const query = { page: 1, limit: 10 };

    it('luôn lọc theo userId (không tab: không lọc status), mới nhất trước', async () => {
      await service.listForBuyer('user-1', query);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 10,
        }),
      );
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('tab → lọc theo ĐÚNG nhóm trạng thái, vẫn kèm userId', async () => {
      await service.listForBuyer('user-1', { ...query, tab: 'processing' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: { in: ['CONFIRMED', 'PACKED'] } },
        }),
      );
    });

    it('phân trang: trang 3, 5 đơn/trang → skip 10', async () => {
      await service.listForBuyer('user-1', { page: 3, limit: 5 });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });

    it('trả total/page/limit và map dữ liệu (tiền là chuỗi số nguyên, ngày ISO)', async () => {
      prisma.order.count.mockResolvedValue(25);
      prisma.order.findMany.mockResolvedValue([loadedOrder()]);

      const result = await service.listForBuyer('user-1', {
        page: 2,
        limit: 10,
      });

      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'o1',
        checkoutGroupId: 'g1',
        status: 'AWAITING_PAYMENT',
        createdAt: '2026-10-01T10:00:00.000Z',
        totalAmount: '220000',
        shop: { id: 's1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
        itemCount: 2,
        paymentMethod: 'VNPAY',
        paymentStatus: 'PENDING',
      });
      expect(result.items[0].items[0]).toEqual({
        productName: 'Sản phẩm 1',
        variantLabel: 'Đỏ / M',
        sku: 'SKU-1',
        imageUrl: null,
        quantity: 1,
        priceAtPurchase: '100000',
      });
    });

    it('xem nhanh dòng hàng tối đa 3, itemCount là tổng thật', async () => {
      const items = [1, 2, 3, 4, 5].map((n) => loadedItem(n));
      prisma.order.findMany.mockResolvedValue([
        loadedOrder({ items: items.slice(0, 3), _count: { items: 5 } }),
      ]);

      const [order] = (await service.listForBuyer('user-1', query)).items;

      expect(order.items).toHaveLength(3);
      expect(order.itemCount).toBe(5);
    });

    it('không có Payment nào — phương thức/trạng thái null, không thử lại được', async () => {
      prisma.order.findMany.mockResolvedValue([
        loadedOrder({
          checkoutGroup: { createdAt: new Date(), payments: [] },
        }),
      ]);

      const [order] = (await service.listForBuyer('user-1', query)).items;

      expect(order.paymentMethod).toBeNull();
      expect(order.paymentStatus).toBeNull();
      expect(order.canRetryPayment).toBe(false);
    });

    it('cờ hành động theo status + phương thức', async () => {
      prisma.order.findMany.mockResolvedValue([
        loadedOrder({ id: 'unpaid' }), // AWAITING_PAYMENT + VNPAY đang chờ, còn hạn
        loadedOrder({
          id: 'paid-online',
          status: 'PENDING',
          checkoutGroup: {
            createdAt: new Date(),
            payments: [
              {
                method: 'VNPAY',
                status: 'SUCCESS',
                expiresAt: new Date(),
                createdAt: new Date(),
              },
            ],
          },
        }),
        loadedOrder({
          id: 'cod',
          status: 'PENDING',
          checkoutGroup: {
            createdAt: new Date(),
            payments: [
              {
                method: 'COD',
                status: 'PENDING',
                expiresAt: null,
                createdAt: new Date(),
              },
            ],
          },
        }),
        loadedOrder({ id: 'shipping', status: 'SHIPPING' }),
      ]);

      const byId = Object.fromEntries(
        (await service.listForBuyer('user-1', query)).items.map((o) => [
          o.id,
          o,
        ]),
      );

      expect(byId.unpaid).toMatchObject({
        canCancel: true,
        canRetryPayment: true,
        canConfirmReceived: false,
      });
      expect(byId['paid-online']).toMatchObject({
        canCancel: false,
        canRetryPayment: false,
        canConfirmReceived: false,
      });
      expect(byId.cod).toMatchObject({
        canCancel: true,
        canRetryPayment: false,
      });
      expect(byId.shipping).toMatchObject({
        canCancel: false,
        canConfirmReceived: true,
      });
    });
  });

  describe('getForBuyer', () => {
    it('lọc theo CẢ id lẫn userId (không tin id suông)', async () => {
      prisma.order.findFirst.mockResolvedValue(loadedDetail());

      await service.getForBuyer('user-1', 'o1');

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1', userId: 'user-1' } }),
      );
    });

    it('đơn không tồn tại / của người khác — 404 ORDER_NOT_FOUND (không phân biệt)', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.getForBuyer('user-1', 'o-khac'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    });

    it('trả đủ dòng hàng, snapshot địa chỉ, tiền, vận chuyển và timeline', async () => {
      const items = [
        loadedItem(1, 2, 100_000),
        loadedItem(2, 1, 50_000),
        loadedItem(3, 1, 10_000),
        loadedItem(4, 1, 10_000),
      ];
      prisma.order.findFirst.mockResolvedValue(
        loadedDetail({
          items,
          _count: { items: 4 },
          discountAmount: D(10_000),
          shippingFee: D(20_000),
          totalAmount: D(280_000),
          carrier: 'GHN',
          trackingCode: 'GHN123',
        }),
      );

      const order = await service.getForBuyer('user-1', 'o1');

      expect(order.items).toHaveLength(4); // đủ, không cắt còn 3 như danh sách
      expect(order.itemCount).toBe(4);
      expect(order.subtotal).toBe('270000'); // 2×100k + 50k + 10k + 10k
      expect(order.discountAmount).toBe('10000');
      expect(order.shippingFee).toBe('20000');
      expect(order.totalAmount).toBe('280000');
      expect(order).toMatchObject({
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        carrier: 'GHN',
        trackingCode: 'GHN123',
      });
      expect(order.history).toEqual([
        {
          fromStatus: null,
          toStatus: 'AWAITING_PAYMENT',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ]);
    });

    it('timeline KHÔNG lộ actorId dù DB có', async () => {
      prisma.order.findFirst.mockResolvedValue(
        loadedDetail({
          statusHistory: [
            {
              fromStatus: 'PENDING',
              toStatus: 'CONFIRMED',
              actorType: 'SELLER',
              actorId: 'seller-secret',
              note: null,
              createdAt: new Date(),
            },
          ],
        }),
      );

      const order = await service.getForBuyer('user-1', 'o1');

      expect(order.history[0]).not.toHaveProperty('actorId');
    });
  });
});
