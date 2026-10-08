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
    // Chi tiết đơn của buyer select thêm quan hệ này để dựng link sản phẩm và nút đánh giá (Week9.md 2.10).
    productVariant: {
      productId: `prod-${n}`,
      product: { slug: `san-pham-${n}` },
    },
  };
}

// Một yêu cầu hủy/trả hàng như BE đọc về cho người mua (Week9.md 2.6): đủ cột + dòng thời gian, không actorId.
function loadedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    kind: 'CANCEL',
    status: 'PENDING_SELLER',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: null,
    sellerRespondBy: new Date('2026-10-03T10:00:00.000Z'),
    statusChangedAt: new Date(),
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    history: [
      {
        toStatus: 'PENDING_SELLER',
        actorType: 'BUYER',
        note: null,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ],
    ...overrides,
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
    // Danh sách chỉ select dòng `→ COMPLETED` mới nhất (cửa sổ trả hàng) và các yêu cầu hủy/trả hàng chưa
    // rút (Week9.md 2.3); chi tiết ghi đè statusHistory bằng đủ lịch sử.
    statusHistory: [],
    refundRequests: [],
    paymentRefund: null,
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
    buyerNote: null,
    // Đánh giá của người mua cho đơn này (chi tiết mới select).
    reviews: [],
    // Chi tiết select thêm ownerId của shop (chỉ để tính cờ canReview) — shop này do 'seller-1' làm chủ,
    // người mua trong các test ('user-1') không phải chủ shop.
    shop: {
      id: 's1',
      name: 'Shop A',
      slug: 'shop-a',
      logoUrl: null,
      ownerId: 'seller-1',
    },
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

    // Week9.md 2.3 — cờ yêu cầu hủy/trả hàng đọc từ DB: loại yêu cầu đã có (chưa rút) và lúc COMPLETED.
    describe('canRequestCancel / canRequestReturn', () => {
      const completedRow = (daysAgo: number) => ({
        toStatus: 'COMPLETED',
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });

      it('chỉ select dòng `→ COMPLETED` mới nhất và yêu cầu chưa rút (không kéo cả timeline ở danh sách)', async () => {
        prisma.order.findMany.mockResolvedValue([]);

        await service.listForBuyer('user-1', query);

        const calls = prisma.order.findMany.mock.calls as [
          { select: Record<string, unknown> },
        ][];
        const arg = calls[0][0];
        expect(arg.select.statusHistory).toEqual({
          where: { toStatus: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { toStatus: true, createdAt: true },
        });
        // Yêu cầu chưa rút, mới nhất trước; history KHÔNG select actorId (không lộ danh tính seller/Admin).
        expect(arg.select.refundRequests).toEqual({
          where: { status: { not: 'WITHDRAWN' } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            status: true,
            reasonCode: true,
            reasonNote: true,
            sellerRespondBy: true,
            statusChangedAt: true,
            createdAt: true,
            history: {
              select: {
                toStatus: true,
                actorType: true,
                note: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        expect(arg.select.paymentRefund).toEqual({
          select: { status: true, amount: true },
        });
      });

      it('shop đã xác nhận/đóng gói: xin hủy được, trừ khi đã có yêu cầu hủy', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({ id: 'confirmed', status: 'CONFIRMED' }),
          loadedOrder({
            id: 'already',
            status: 'PACKED',
            refundRequests: [loadedRequest({ kind: 'CANCEL' })],
          }),
          loadedOrder({
            id: 'return-only',
            status: 'CONFIRMED',
            refundRequests: [loadedRequest({ kind: 'RETURN' })],
          }),
        ]);

        const byId = Object.fromEntries(
          (await service.listForBuyer('user-1', query)).items.map((o) => [
            o.id,
            o,
          ]),
        );

        expect(byId.confirmed).toMatchObject({
          canRequestCancel: true,
          canCancel: false,
          canRequestReturn: false,
        });
        expect(byId.already.canRequestCancel).toBe(false);
        expect(byId['return-only'].canRequestCancel).toBe(true);
      });

      it('đơn COMPLETED: trả hàng được trong cửa sổ (REFUND_WINDOW_DAYS, mặc định 7), quá hạn hoặc đã có yêu cầu thì tắt', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            id: 'fresh',
            status: 'COMPLETED',
            statusHistory: [completedRow(2)],
          }),
          loadedOrder({
            id: 'expired',
            status: 'COMPLETED',
            statusHistory: [completedRow(8)],
          }),
          loadedOrder({
            id: 'requested',
            status: 'COMPLETED',
            statusHistory: [completedRow(1)],
            refundRequests: [loadedRequest({ kind: 'RETURN' })],
          }),
          // Thiếu dòng lịch sử `→ COMPLETED` (không nên xảy ra): khoá cho an toàn.
          loadedOrder({ id: 'no-history', status: 'COMPLETED' }),
        ]);

        const byId = Object.fromEntries(
          (await service.listForBuyer('user-1', query)).items.map((o) => [
            o.id,
            o,
          ]),
        );

        expect(byId.fresh.canRequestReturn).toBe(true);
        expect(byId.expired.canRequestReturn).toBe(false);
        expect(byId.requested.canRequestReturn).toBe(false);
        expect(byId['no-history'].canRequestReturn).toBe(false);
      });

      it('chi tiết đọc lúc COMPLETED từ đủ lịch sử (lọc theo toStatus, bỏ qua các dòng khác)', async () => {
        const completed = new Date(Date.now() - 24 * 60 * 60 * 1000);
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: [
              {
                fromStatus: 'SHIPPING',
                toStatus: 'COMPLETED',
                actorType: 'BUYER',
                note: null,
                createdAt: completed,
              },
              {
                fromStatus: null,
                toStatus: 'PENDING',
                actorType: 'BUYER',
                note: null,
                createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
              },
            ],
          }),
        );

        const detail = await service.getForBuyer('user-1', 'o1');

        expect(detail.canRequestReturn).toBe(true);
      });

      it('chọn dòng COMPLETED MỚI NHẤT nếu có nhiều (mốc để tính cửa sổ)', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            id: 'o',
            status: 'COMPLETED',
            statusHistory: [completedRow(30), completedRow(1)],
          }),
        ]);

        const [item] = (await service.listForBuyer('user-1', query)).items;

        expect(item.canRequestReturn).toBe(true);
      });
    });

    // Week9.md 2.6 — yêu cầu mới nhất + khoản hoàn tiền của đơn trong danh sách / chi tiết.
    describe('refundRequest / refund', () => {
      it('đơn chưa có yêu cầu / khoản hoàn: cả hai là null', async () => {
        prisma.order.findMany.mockResolvedValue([loadedOrder()]);

        const [item] = (await service.listForBuyer('user-1', query)).items;

        expect(item.refundRequest).toBeNull();
        expect(item.refund).toBeNull();
      });

      it('map yêu cầu: ngày ISO, dòng thời gian cũ → mới không có actorId, cờ canWithdraw khi seller chưa trả lời', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            status: 'CONFIRMED',
            refundRequests: [
              loadedRequest({
                reasonCode: 'OTHER',
                reasonNote: 'Đặt trùng đơn',
                history: [
                  {
                    toStatus: 'PENDING_SELLER',
                    actorType: 'BUYER',
                    note: null,
                    createdAt: new Date('2026-10-01T10:00:00.000Z'),
                    actorId: 'buyer-secret',
                  },
                ],
              }),
            ],
          }),
        ]);

        const [item] = (await service.listForBuyer('user-1', query)).items;

        expect(item.refundRequest).toEqual({
          id: 'req-1',
          kind: 'CANCEL',
          status: 'PENDING_SELLER',
          reasonCode: 'OTHER',
          reasonNote: 'Đặt trùng đơn',
          sellerRespondBy: '2026-10-03T10:00:00.000Z',
          statusChangedAt: expect.any(String) as string,
          createdAt: '2026-10-01T10:00:00.000Z',
          history: [
            {
              toStatus: 'PENDING_SELLER',
              actorType: 'BUYER',
              note: null,
              // Khớp CHÍNH XÁC (toEqual): actorId của dòng history gốc không được lọt ra response.
              createdAt: '2026-10-01T10:00:00.000Z',
            },
          ],
          canWithdraw: true,
          canEscalate: false,
        });
      });

      it('lấy yêu cầu MỚI NHẤT (BE đã sắp mới nhất trước), các yêu cầu cũ chỉ góp vào cờ canRequest*', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            status: 'COMPLETED',
            statusHistory: [{ toStatus: 'COMPLETED', createdAt: new Date() }],
            refundRequests: [
              loadedRequest({ id: 'return', kind: 'RETURN' }),
              loadedRequest({
                id: 'cancel',
                kind: 'CANCEL',
                status: 'REJECTED_BY_SELLER',
              }),
            ],
          }),
        ]);

        const [item] = (await service.listForBuyer('user-1', query)).items;

        expect(item.refundRequest?.id).toBe('return');
        // Đã có cả yêu cầu hủy lẫn trả hàng ⇒ không gửi thêm yêu cầu trả hàng nữa.
        expect(item.canRequestReturn).toBe(false);
      });

      it('seller đã từ chối, còn trong hạn khiếu nại (REFUND_ESCALATE_DAYS, mặc định 3) ⇒ canEscalate; hết hạn ⇒ tắt', async () => {
        const day = 24 * 60 * 60 * 1000;
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            id: 'fresh',
            status: 'CONFIRMED',
            refundRequests: [
              loadedRequest({
                status: 'REJECTED_BY_SELLER',
                statusChangedAt: new Date(Date.now() - day),
              }),
            ],
          }),
          loadedOrder({
            id: 'expired',
            status: 'CONFIRMED',
            refundRequests: [
              loadedRequest({
                status: 'REJECTED_BY_SELLER',
                statusChangedAt: new Date(Date.now() - 4 * day),
              }),
            ],
          }),
        ]);

        const byId = Object.fromEntries(
          (await service.listForBuyer('user-1', query)).items.map((o) => [
            o.id,
            o,
          ]),
        );

        expect(byId.fresh.refundRequest).toMatchObject({
          canEscalate: true,
          canWithdraw: false,
        });
        expect(byId.expired.refundRequest).toMatchObject({
          canEscalate: false,
          canWithdraw: false,
        });
      });

      it('khoản hoàn tiền: chỉ trạng thái + số tiền (chuỗi nguyên), không lộ lý do lỗi/mã cổng', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({
            status: 'CANCELLED',
            paymentRefund: {
              status: 'PENDING',
              amount: D(220_000),
              failureReason: 'bí mật',
              gatewayRef: 'GW-1',
            },
          }),
        ]);

        const [item] = (await service.listForBuyer('user-1', query)).items;

        expect(item.refund).toEqual({ status: 'PENDING', amount: '220000' });
      });

      it('chi tiết trả cùng refundRequest / refund như danh sách', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'CONFIRMED',
            refundRequests: [loadedRequest()],
            paymentRefund: { status: 'SUCCEEDED', amount: D(220_000) },
          }),
        );

        const detail = await service.getForBuyer('user-1', 'o1');

        expect(detail.refundRequest?.status).toBe('PENDING_SELLER');
        expect(detail.refund).toEqual({
          status: 'SUCCEEDED',
          amount: '220000',
        });
      });
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
      // Từ 2.6 đơn đã trả online mà shop chưa xác nhận hủy ngay được (kèm hoàn tiền tự động).
      expect(byId['paid-online']).toMatchObject({
        canCancel: true,
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

    // --- Dòng hàng: định danh sản phẩm + trạng thái đánh giá (Week9.md 1.8, 2.10) ---------------------------
    describe('dòng hàng và đánh giá', () => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const completedHistory = (daysAgo: number) => [
        {
          fromStatus: 'SHIPPING',
          toStatus: 'COMPLETED',
          actorType: 'BUYER',
          note: null,
          createdAt: new Date(Date.now() - daysAgo * DAY_MS),
        },
      ];
      const loadedReview = (overrides: Record<string, unknown> = {}) => ({
        id: 'rv-1',
        productId: 'prod-1',
        rating: 4,
        comment: 'Tốt',
        editedAt: null,
        ...overrides,
      });

      afterEach(() => {
        delete process.env.REVIEW_WINDOW_DAYS;
      });

      it('select kèm quan hệ variant → sản phẩm (productId + slug) và đánh giá của đơn; danh sách thì KHÔNG đọc các cột này', async () => {
        prisma.order.findFirst.mockResolvedValue(loadedDetail());
        await service.getForBuyer('user-1', 'o1');
        const [detailArgs] = prisma.order.findFirst.mock.calls[0] as [
          {
            select: {
              items: { select: Record<string, unknown> };
              reviews: { select: Record<string, boolean> };
            };
          },
        ];
        expect(detailArgs.select.items.select.productVariant).toEqual({
          select: { productId: true, product: { select: { slug: true } } },
        });
        expect(detailArgs.select.reviews.select).toEqual({
          id: true,
          productId: true,
          rating: true,
          comment: true,
          editedAt: true,
        });

        await service.listForBuyer('user-1', { page: 1, limit: 10 });
        const [listArgs] = prisma.order.findMany.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        expect(listArgs.select).not.toHaveProperty('reviews');
      });

      it('mỗi dòng trả productId + productSlug (OrderItem không có productId, nối qua variant)', async () => {
        prisma.order.findFirst.mockResolvedValue(loadedDetail());

        const order = await service.getForBuyer('user-1', 'o1');

        expect(
          order.items.map((item) => [item.productId, item.productSlug]),
        ).toEqual([
          ['prod-1', 'san-pham-1'],
          ['prod-2', 'san-pham-2'],
        ]);
        // Snapshot cũ của dòng hàng vẫn còn nguyên.
        expect(order.items[0]).toMatchObject({
          productName: 'Sản phẩm 1',
          sku: 'SKU-1',
          priceAtPurchase: '100000',
        });
      });

      it('đơn COMPLETED trong cửa sổ, chưa đánh giá ⇒ canReview true, review null', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(3),
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(
          order.items.map((item) => [item.canReview, item.review]),
        ).toEqual([
          [true, null],
          [true, null],
        ]);
      });

      it('đã đánh giá sản phẩm ⇒ canReview false, review đủ rating/nhận xét/cờ sửa (chưa sửa ⇒ canEdit true); dòng sản phẩm khác không ảnh hưởng', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(3),
            reviews: [loadedReview()],
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items[0]).toMatchObject({
          productId: 'prod-1',
          canReview: false,
          review: {
            id: 'rv-1',
            rating: 4,
            comment: 'Tốt',
            editedAt: null,
            canEdit: true,
          },
        });
        expect(order.items[1]).toMatchObject({ canReview: true, review: null });
      });

      it('đã sửa một lần (editedAt có giá trị) ⇒ canEdit false, editedAt dạng ISO', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(3),
            reviews: [
              loadedReview({
                comment: null,
                editedAt: new Date('2026-10-05T08:00:00.000Z'),
              }),
            ],
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items[0].review).toEqual({
          id: 'rv-1',
          rating: 4,
          comment: null,
          editedAt: '2026-10-05T08:00:00.000Z',
          canEdit: false,
        });
      });

      it('hai dòng cùng một sản phẩm (khác biến thể) dùng chung một đánh giá và cùng cờ', async () => {
        const sameProduct = (n: number) => ({
          ...loadedItem(n),
          productVariant: {
            productId: 'prod-1',
            product: { slug: 'san-pham-1' },
          },
        });
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(3),
            items: [sameProduct(1), sameProduct(2)],
            reviews: [loadedReview()],
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items.map((item) => item.review?.id)).toEqual([
          'rv-1',
          'rv-1',
        ]);
        expect(order.items.map((item) => item.canReview)).toEqual([
          false,
          false,
        ]);
      });

      it.each([
        'AWAITING_PAYMENT',
        'PENDING',
        'CONFIRMED',
        'PACKED',
        'SHIPPING',
        'CANCELLED',
        'REFUNDED',
      ])(
        'đơn %s (chưa/không còn COMPLETED) ⇒ canReview false trên mọi dòng',
        async (status) => {
          prisma.order.findFirst.mockResolvedValue(
            loadedDetail({ status, statusHistory: completedHistory(3) }),
          );

          const order = await service.getForBuyer('user-1', 'o1');

          expect(order.items.every((item) => !item.canReview)).toBe(true);
        },
      );

      it('đơn REFUNDED vẫn giữ đánh giá đã viết (hiện review, không cho viết thêm)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'REFUNDED',
            statusHistory: completedHistory(3),
            reviews: [loadedReview()],
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items[0]).toMatchObject({
          canReview: false,
          review: { id: 'rv-1' },
        });
      });

      it('quá cửa sổ mặc định 90 ngày ⇒ canReview false; còn trong cửa sổ ⇒ true', async () => {
        prisma.order.findFirst.mockResolvedValueOnce(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(91),
          }),
        );
        expect(
          (await service.getForBuyer('user-1', 'o1')).items[0].canReview,
        ).toBe(false);

        prisma.order.findFirst.mockResolvedValueOnce(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(89),
          }),
        );
        expect(
          (await service.getForBuyer('user-1', 'o1')).items[0].canReview,
        ).toBe(true);
      });

      it('REVIEW_WINDOW_DAYS đọc LÚC DÙNG (đổi giữa hai lần gọi có hiệu lực ngay)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(10),
          }),
        );
        process.env.REVIEW_WINDOW_DAYS = '7';
        expect(
          (await service.getForBuyer('user-1', 'o1')).items[0].canReview,
        ).toBe(false);

        process.env.REVIEW_WINDOW_DAYS = '30';
        expect(
          (await service.getForBuyer('user-1', 'o1')).items[0].canReview,
        ).toBe(true);
      });

      it('đơn của CHÍNH shop mình (chủ shop xem đơn tự mua từ trước khi có luật chặn mua) ⇒ canReview false trên mọi dòng, dù COMPLETED trong cửa sổ', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({
            status: 'COMPLETED',
            statusHistory: completedHistory(3),
            shop: {
              id: 's1',
              name: 'Shop A',
              slug: 'shop-a',
              logoUrl: null,
              ownerId: 'user-1',
            },
          }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items.every((item) => !item.canReview)).toBe(true);
      });

      it('select kèm ownerId của shop, nhưng response KHÔNG lộ ownerId (định danh chủ shop)', async () => {
        prisma.order.findFirst.mockResolvedValue(loadedDetail());

        const order = await service.getForBuyer('user-1', 'o1');

        const [args] = prisma.order.findFirst.mock.calls[0] as [
          { select: { shop: { select: Record<string, boolean> } } },
        ];
        expect(args.select.shop.select.ownerId).toBe(true);
        expect(order.shop).toEqual({
          id: 's1',
          name: 'Shop A',
          slug: 'shop-a',
          logoUrl: null,
        });
        expect(JSON.stringify(order)).not.toContain('seller-1');
      });

      it('COMPLETED mà không còn dấu vết lúc hoàn tất trong lịch sử ⇒ canReview false (từ chối an toàn)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          loadedDetail({ status: 'COMPLETED' }),
        );

        const order = await service.getForBuyer('user-1', 'o1');

        expect(order.items.every((item) => !item.canReview)).toBe(true);
      });
    });

    describe('buyerNote (Week8.md 3B)', () => {
      it('chi tiết trả đúng lời nhắn của đơn, null khi không có', async () => {
        prisma.order.findFirst.mockResolvedValueOnce(
          loadedDetail({ buyerNote: 'Giao giờ hành chính' }),
        );
        expect((await service.getForBuyer('user-1', 'o1')).buyerNote).toBe(
          'Giao giờ hành chính',
        );

        prisma.order.findFirst.mockResolvedValueOnce(loadedDetail());
        expect(
          (await service.getForBuyer('user-1', 'o1')).buyerNote,
        ).toBeNull();
      });

      it('chi tiết select buyerNote, còn danh sách thì KHÔNG (không đọc cột không cần)', async () => {
        prisma.order.findFirst.mockResolvedValue(loadedDetail());
        await service.getForBuyer('user-1', 'o1');
        const [detailArgs] = prisma.order.findFirst.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        expect(detailArgs.select.buyerNote).toBe(true);

        await service.listForBuyer('user-1', { page: 1, limit: 10 });
        const [listArgs] = prisma.order.findMany.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        expect(listArgs.select).not.toHaveProperty('buyerNote');
      });

      it('danh sách đơn của buyer không lộ buyerNote kể cả khi dòng đọc về có field đó', async () => {
        prisma.order.findMany.mockResolvedValue([
          loadedOrder({ buyerNote: 'không nên xuất hiện ở danh sách' }),
        ]);

        const [item] = (
          await service.listForBuyer('user-1', { page: 1, limit: 10 })
        ).items;

        expect(item).not.toHaveProperty('buyerNote');
      });
    });
  });
});

// Một yêu cầu hủy/trả hàng như BE đọc về cho SELLER (Week9.md 2.7): chi tiết/hàng chờ đủ cột + dòng thời gian;
// danh sách đơn chỉ cần id/kind/status/sellerRespondBy (phần thừa bị bỏ khi map).
function sellerRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    kind: 'CANCEL',
    status: 'PENDING_SELLER',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: 'Đổi ý',
    sellerRespondBy: new Date('2026-10-03T10:00:00.000Z'),
    statusChangedAt: new Date('2026-10-01T12:00:00.000Z'),
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    history: [
      {
        toStatus: 'PENDING_SELLER',
        actorType: 'BUYER',
        note: null,
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
        actorId: 'buyer-secret',
      },
    ],
    ...overrides,
  };
}

function sellerLoaded(overrides: Record<string, unknown> = {}) {
  const items = [loadedItem(1), loadedItem(2)];
  return {
    id: 'o1',
    status: 'PENDING',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    totalAmount: D(220_000),
    recipientName: 'Nguyễn Văn A',
    shippingProvince: 'Hồ Chí Minh',
    buyerNote: null,
    items,
    _count: { items: items.length },
    checkoutGroup: { payments: [{ method: 'VNPAY', status: 'SUCCESS' }] },
    // Yêu cầu hủy/trả hàng chưa rút của đơn (kind + status) — để tắt canPack/canShip khi có yêu cầu HỦY chờ.
    refundRequests: [],
    ...overrides,
  };
}

describe('OrderQueryService (seller)', () => {
  let service: OrderQueryService;
  let prisma: {
    order: { count: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  };

  const VISIBLE = [
    'PENDING',
    'CONFIRMED',
    'PACKED',
    'SHIPPING',
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
  ];

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

  describe('listForSeller', () => {
    const query = { page: 1, limit: 10 };

    it('luôn lọc theo shopId VÀ chỉ trạng thái Seller được thấy — KHÔNG có AWAITING_PAYMENT', async () => {
      await service.listForSeller('shop-1', query);

      const expected = {
        shopId: 'shop-1',
        status: { in: VISIBLE },
        statusHistory: { some: { toStatus: 'PENDING' } },
      };
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      expect(prisma.order.count).toHaveBeenCalledWith({ where: expected });
      expect(VISIBLE).not.toContain('AWAITING_PAYMENT');
    });

    it('tab chỉ THU HẸP trong tập được thấy', async () => {
      await service.listForSeller('shop-1', { ...query, tab: 'processing' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: 'shop-1',
            status: { in: ['CONFIRMED', 'PACKED'] },
            statusHistory: { some: { toStatus: 'PENDING' } },
          },
        }),
      );
    });

    it('tab lọt qua kiểu (ép bằng cast) vẫn không lộ AWAITING_PAYMENT — phòng thủ nhiều lớp', async () => {
      await service.listForSeller('shop-1', {
        ...query,
        tab: 'awaiting-payment' as unknown as 'pending',
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: 'shop-1',
            status: { in: [] },
            statusHistory: { some: { toStatus: 'PENDING' } },
          },
        }),
      );
    });

    it('phân trang, thứ tự và map dữ liệu (không có userId/email buyer)', async () => {
      prisma.order.count.mockResolvedValue(12);
      prisma.order.findMany.mockResolvedValue([sellerLoaded()]);

      const result = await service.listForSeller('shop-1', {
        page: 2,
        limit: 5,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 5,
          take: 5,
        }),
      );
      expect(result).toMatchObject({ total: 12, page: 2, limit: 5 });
      expect(result.items[0]).toEqual({
        id: 'o1',
        status: 'PENDING',
        createdAt: '2026-10-01T10:00:00.000Z',
        totalAmount: '220000',
        recipientName: 'Nguyễn Văn A',
        shippingProvince: 'Hồ Chí Minh',
        buyerNote: null,
        items: expect.any(Array) as unknown[],
        itemCount: 2,
        paymentMethod: 'VNPAY',
        paymentStatus: 'SUCCESS',
        canConfirm: true,
        canPack: false,
        canShip: false,
        canReject: true,
        canCancel: false,
        refundRequest: null,
      });
    });

    // Từ 2.7 từ chối đơn chờ xác nhận mở cho mọi phương thức (đã trả online thì hoàn tiền tự động).
    it('cờ hành động theo status: đơn chờ xác nhận từ chối được CẢ COD lẫn đã trả online', async () => {
      prisma.order.findMany.mockResolvedValue([
        sellerLoaded({
          id: 'cod',
          checkoutGroup: { payments: [{ method: 'COD', status: 'PENDING' }] },
        }),
        sellerLoaded({ id: 'online' }),
        sellerLoaded({ id: 'packed', status: 'PACKED' }),
      ]);

      const byId = Object.fromEntries(
        (await service.listForSeller('shop-1', query)).items.map((o) => [
          o.id,
          o,
        ]),
      );

      expect(byId.cod).toMatchObject({ canConfirm: true, canReject: true });
      expect(byId.online).toMatchObject({ canConfirm: true, canReject: true });
      expect(byId.packed).toMatchObject({ canShip: true, canConfirm: false });
    });

    // Week9.md 2.3 — tự hủy đơn đã xác nhận/đóng gói, và yêu cầu hủy của người mua chặn đóng gói/giao.
    it('canCancel (tự hủy) chỉ ở CONFIRMED/PACKED', async () => {
      prisma.order.findMany.mockResolvedValue([
        sellerLoaded({ id: 'pending' }),
        sellerLoaded({ id: 'confirmed', status: 'CONFIRMED' }),
        sellerLoaded({ id: 'packed', status: 'PACKED' }),
        sellerLoaded({ id: 'shipping', status: 'SHIPPING' }),
      ]);

      const byId = Object.fromEntries(
        (await service.listForSeller('shop-1', query)).items.map((o) => [
          o.id,
          o,
        ]),
      );

      expect(byId.pending.canCancel).toBe(false);
      expect(byId.confirmed.canCancel).toBe(true);
      expect(byId.packed.canCancel).toBe(true);
      expect(byId.shipping.canCancel).toBe(false);
    });

    it('yêu cầu HỦY đang chờ (seller hoặc Admin) tắt đóng gói/giao nhưng không tắt tự hủy', async () => {
      prisma.order.findMany.mockResolvedValue([
        sellerLoaded({
          id: 'blocked-pack',
          status: 'CONFIRMED',
          refundRequests: [
            sellerRequest({ kind: 'CANCEL', status: 'PENDING_SELLER' }),
          ],
        }),
        sellerLoaded({
          id: 'blocked-ship',
          status: 'PACKED',
          refundRequests: [
            sellerRequest({ kind: 'CANCEL', status: 'ESCALATED' }),
          ],
        }),
        sellerLoaded({
          id: 'rejected',
          status: 'CONFIRMED',
          refundRequests: [
            sellerRequest({ kind: 'CANCEL', status: 'REJECTED_BY_SELLER' }),
          ],
        }),
      ]);

      const byId = Object.fromEntries(
        (await service.listForSeller('shop-1', query)).items.map((o) => [
          o.id,
          o,
        ]),
      );

      expect(byId['blocked-pack']).toMatchObject({
        canPack: false,
        canCancel: true,
      });
      expect(byId['blocked-ship']).toMatchObject({
        canShip: false,
        canCancel: true,
      });
      // Seller đã từ chối yêu cầu thì không còn gì để chờ: đóng gói tiếp được.
      expect(byId.rejected.canPack).toBe(true);
    });

    it('danh sách chỉ select id/kind/status/hạn phản hồi của yêu cầu chưa rút (không đọc lý do/ghi chú của người mua)', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.listForSeller('shop-1', query);

      const calls = prisma.order.findMany.mock.calls as [
        { select: Record<string, unknown> },
      ][];
      const arg = calls[0][0];
      expect(arg.select.refundRequests).toEqual({
        where: { status: { not: 'WITHDRAWN' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, status: true, sellerRespondBy: true },
      });
    });

    it('mỗi đơn mang TÓM TẮT yêu cầu mới nhất (id, loại, trạng thái, hạn phản hồi), không có lý do của người mua', async () => {
      prisma.order.findMany.mockResolvedValue([
        sellerLoaded({
          status: 'CONFIRMED',
          refundRequests: [
            sellerRequest({ id: 'newest', kind: 'CANCEL' }),
            sellerRequest({ id: 'older', kind: 'RETURN' }),
          ],
        }),
      ]);

      const [item] = (await service.listForSeller('shop-1', query)).items;

      expect(item.refundRequest).toEqual({
        id: 'newest',
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        sellerRespondBy: '2026-10-03T10:00:00.000Z',
      });
    });
  });

  describe('getForSeller', () => {
    it('lọc theo id + shopId + trạng thái được thấy (đơn chưa thanh toán không đọc được)', async () => {
      prisma.order.findFirst.mockResolvedValue(
        sellerLoaded({
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          discountAmount: D(0),
          shippingFee: D(20_000),
          carrier: null,
          trackingCode: null,
          statusHistory: [],
        }),
      );

      await service.getForSeller('shop-1', 'o1');

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'o1',
            shopId: 'shop-1',
            status: { in: VISIBLE },
            statusHistory: { some: { toStatus: 'PENDING' } },
          },
        }),
      );
    });

    it('đơn không tồn tại / shop khác / chưa thanh toán — cùng 404 ORDER_NOT_FOUND', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expectAppException(service.getForSeller('shop-1', 'o-khac'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    });

    it('trả người nhận, đủ dòng hàng, tiền, vận chuyển và timeline (không actorId)', async () => {
      const items = [loadedItem(1, 2, 100_000), loadedItem(2, 1, 50_000)];
      prisma.order.findFirst.mockResolvedValue(
        sellerLoaded({
          items,
          _count: { items: 2 },
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          discountAmount: D(10_000),
          shippingFee: D(20_000),
          carrier: 'GHN',
          trackingCode: 'GHN123',
          statusHistory: [
            {
              fromStatus: 'AWAITING_PAYMENT',
              toStatus: 'PENDING',
              actorType: 'SYSTEM',
              actorId: null,
              note: 'Payment confirmed',
              createdAt: new Date('2026-10-01T10:05:00.000Z'),
            },
          ],
        }),
      );

      const order = await service.getForSeller('shop-1', 'o1');

      expect(order).toMatchObject({
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        subtotal: '250000',
        discountAmount: '10000',
        shippingFee: '20000',
        carrier: 'GHN',
        trackingCode: 'GHN123',
      });
      expect(order.items).toHaveLength(2);
      expect(order.history).toEqual([
        {
          fromStatus: 'AWAITING_PAYMENT',
          toStatus: 'PENDING',
          actorType: 'SYSTEM',
          note: 'Payment confirmed',
          createdAt: '2026-10-01T10:05:00.000Z',
        },
      ]);
      expect(order).not.toHaveProperty('userId');
      expect(order.history[0]).not.toHaveProperty('actorId');
    });

    describe('refundRequest (Week9.md 2.7)', () => {
      const detail = (overrides: Record<string, unknown> = {}) =>
        sellerLoaded({
          status: 'CONFIRMED',
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          discountAmount: D(0),
          shippingFee: D(20_000),
          carrier: null,
          trackingCode: null,
          statusHistory: [],
          ...overrides,
        });

      it('chi tiết select ĐỦ cột yêu cầu + dòng thời gian KHÔNG có actorId', async () => {
        prisma.order.findFirst.mockResolvedValue(detail());

        await service.getForSeller('shop-1', 'o1');

        const [args] = prisma.order.findFirst.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        const select = (
          args.select.refundRequests as { select: Record<string, unknown> }
        ).select;
        expect(Object.keys(select).sort()).toEqual(
          [
            'createdAt',
            'history',
            'id',
            'kind',
            'reasonCode',
            'reasonNote',
            'sellerRespondBy',
            'statusChangedAt',
            'status',
          ].sort(),
        );
        expect(select.history).toEqual({
          select: {
            toStatus: true,
            actorType: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        });
      });

      it('chi tiết trả lý do của người mua, timeline (không actorId) và cờ duyệt/từ chối', async () => {
        prisma.order.findFirst.mockResolvedValue(
          detail({ refundRequests: [sellerRequest()] }),
        );

        const order = await service.getForSeller('shop-1', 'o1');

        expect(order.refundRequest).toEqual({
          id: 'req-1',
          kind: 'CANCEL',
          status: 'PENDING_SELLER',
          sellerRespondBy: '2026-10-03T10:00:00.000Z',
          reasonCode: 'CHANGE_OF_MIND',
          reasonNote: 'Đổi ý',
          statusChangedAt: '2026-10-01T12:00:00.000Z',
          createdAt: '2026-10-01T12:00:00.000Z',
          history: [
            {
              toStatus: 'PENDING_SELLER',
              actorType: 'BUYER',
              note: null,
              createdAt: '2026-10-01T12:00:00.000Z',
            },
          ],
          canApprove: true,
          canReject: true,
        });
        expect(order.canPack).toBe(false); // đang có yêu cầu hủy chờ: chặn đóng gói
      });

      it('chưa có yêu cầu ⇒ null; yêu cầu trả hàng đã lên sàn ⇒ seller không duyệt/từ chối được', async () => {
        prisma.order.findFirst.mockResolvedValueOnce(detail());
        expect(
          (await service.getForSeller('shop-1', 'o1')).refundRequest,
        ).toBeNull();

        prisma.order.findFirst.mockResolvedValueOnce(
          detail({
            status: 'COMPLETED',
            refundRequests: [
              sellerRequest({ kind: 'RETURN', status: 'ESCALATED' }),
            ],
          }),
        );
        expect(
          (await service.getForSeller('shop-1', 'o1')).refundRequest,
        ).toMatchObject({ canApprove: false, canReject: false });
      });
    });

    describe('buyerNote (Week8.md 3B)', () => {
      it('danh sách và chi tiết trả lời nhắn của đúng đơn, null khi không có', async () => {
        prisma.order.findMany.mockResolvedValue([
          sellerLoaded({ id: 'a', buyerNote: 'Gọi trước khi giao' }),
          sellerLoaded({ id: 'b' }),
        ]);
        const byId = Object.fromEntries(
          (
            await service.listForSeller('shop-1', { page: 1, limit: 10 })
          ).items.map((o) => [o.id, o]),
        );
        expect(byId.a.buyerNote).toBe('Gọi trước khi giao');
        expect(byId.b.buyerNote).toBeNull();

        prisma.order.findFirst.mockResolvedValue(
          sellerLoaded({
            buyerNote: 'Gói quà',
            recipientPhone: '0912345678',
            shippingAddressLine: '12 Nguyễn Huệ',
            shippingWard: 'Phường Bến Nghé',
            discountAmount: D(0),
            shippingFee: D(20_000),
            carrier: null,
            trackingCode: null,
            statusHistory: [],
          }),
        );
        expect((await service.getForSeller('shop-1', 'a')).buyerNote).toBe(
          'Gói quà',
        );
      });

      it('cả danh sách lẫn chi tiết đều select buyerNote (mock không tự kiểm select nên kiểm tường minh)', async () => {
        prisma.order.findFirst.mockResolvedValue(
          sellerLoaded({
            recipientPhone: '0912345678',
            shippingAddressLine: '12 Nguyễn Huệ',
            shippingWard: 'Phường Bến Nghé',
            discountAmount: D(0),
            shippingFee: D(20_000),
            carrier: null,
            trackingCode: null,
            statusHistory: [],
          }),
        );
        await service.listForSeller('shop-1', { page: 1, limit: 10 });
        await service.getForSeller('shop-1', 'o1');

        const [listArgs] = prisma.order.findMany.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        const [detailArgs] = prisma.order.findFirst.mock.calls[0] as [
          { select: Record<string, unknown> },
        ];
        expect(listArgs.select.buyerNote).toBe(true);
        expect(detailArgs.select.buyerNote).toBe(true);
      });
    });
  });

  // --- Hàng chờ yêu cầu của seller (Week9.md 2.7) ----------------------------------------------
  describe('hàng chờ yêu cầu hủy/trả hàng của shop', () => {
    let refundPrisma: {
      refundRequest: {
        count: jest.Mock;
        findMany: jest.Mock;
        findFirst: jest.Mock;
      };
    };
    let refundService: OrderQueryService;
    const query = { page: 1, limit: 10 };

    const listed = (overrides: Record<string, unknown> = {}) => ({
      ...sellerRequest(),
      order: {
        id: 'o1',
        status: 'CONFIRMED',
        totalAmount: D(220_000),
        recipientName: 'Nguyễn Văn A',
        items: [loadedItem(1), loadedItem(2)],
        _count: { items: 2 },
        checkoutGroup: { payments: [{ method: 'VNPAY', status: 'SUCCESS' }] },
      },
      ...overrides,
    });

    beforeEach(() => {
      refundPrisma = {
        refundRequest: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      refundService = new OrderQueryService(
        refundPrisma as unknown as PrismaService,
      );
    });

    it('luôn lọc theo shopId + đơn Seller được thấy (predicate dùng chung); không status ⇒ mọi yêu cầu chưa rút', async () => {
      await refundService.listRefundRequestsForSeller('shop-1', query);

      const expected = {
        shopId: 'shop-1',
        status: { not: 'WITHDRAWN' },
        order: {
          status: { in: VISIBLE },
          statusHistory: { some: { toStatus: 'PENDING' } },
        },
      };
      expect(refundPrisma.refundRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      expect(refundPrisma.refundRequest.count).toHaveBeenCalledWith({
        where: expected,
      });
    });

    it('lọc theo status; "chờ shop trả lời" xếp CŨ NHẤT TRƯỚC (hạn sớm nhất lên đầu), bộ lọc khác mới nhất trước', async () => {
      await refundService.listRefundRequestsForSeller('shop-1', {
        ...query,
        status: 'PENDING_SELLER',
      });
      await refundService.listRefundRequestsForSeller('shop-1', {
        ...query,
        status: 'ESCALATED',
      });
      await refundService.listRefundRequestsForSeller('shop-1', query);

      const calls = refundPrisma.refundRequest.findMany.mock.calls as [
        { where: { status: unknown }; orderBy: unknown },
      ][];
      expect(calls[0][0].where.status).toBe('PENDING_SELLER');
      expect(calls[0][0].orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
      expect(calls[1][0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(calls[2][0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('phân trang: trang 3, 5 dòng/trang → skip 10', async () => {
      await refundService.listRefundRequestsForSeller('shop-1', {
        page: 3,
        limit: 5,
      });

      expect(refundPrisma.refundRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });

    it('trả yêu cầu đầy đủ + tóm tắt đơn; timeline không actorId; tiền là chuỗi, ngày ISO', async () => {
      refundPrisma.refundRequest.count.mockResolvedValue(1);
      refundPrisma.refundRequest.findMany.mockResolvedValue([listed()]);

      const result = await refundService.listRefundRequestsForSeller(
        'shop-1',
        query,
      );

      expect(result).toMatchObject({ total: 1, page: 1, limit: 10 });
      const [item] = result.items;
      expect(item).toMatchObject({
        id: 'req-1',
        kind: 'CANCEL',
        status: 'PENDING_SELLER',
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Đổi ý',
        sellerRespondBy: '2026-10-03T10:00:00.000Z',
        canApprove: true,
        canReject: true,
        order: {
          id: 'o1',
          status: 'CONFIRMED',
          totalAmount: '220000',
          recipientName: 'Nguyễn Văn A',
          itemCount: 2,
          paymentMethod: 'VNPAY',
          paymentStatus: 'SUCCESS',
        },
      });
      expect(item.history[0]).not.toHaveProperty('actorId');
      expect(item.order.items).toHaveLength(2);
    });

    it('đơn chưa có Payment ⇒ phương thức/trạng thái thanh toán null, không lỗi', async () => {
      refundPrisma.refundRequest.findMany.mockResolvedValue([
        listed({
          order: {
            ...listed().order,
            checkoutGroup: { payments: [] },
          },
        }),
      ]);

      const [item] = (
        await refundService.listRefundRequestsForSeller('shop-1', query)
      ).items;

      expect(item.order.paymentMethod).toBeNull();
      expect(item.order.paymentStatus).toBeNull();
    });

    it('chỉ select tối đa ORDER_LIST_PREVIEW_ITEMS dòng hàng của đơn và KHÔNG select thông tin người mua (chỉ người nhận)', async () => {
      await refundService.listRefundRequestsForSeller('shop-1', query);

      const [args] = refundPrisma.refundRequest.findMany.mock.calls[0] as [
        { select: { order: { select: Record<string, unknown> } } },
      ];
      const orderSelect = args.select.order.select;
      expect((orderSelect.items as { take: number }).take).toBe(3);
      expect(orderSelect).not.toHaveProperty('userId');
      expect(orderSelect).not.toHaveProperty('user');
    });

    describe('getRefundRequestForSeller', () => {
      it('lọc theo id + shopId + chưa rút + đơn Seller được thấy', async () => {
        refundPrisma.refundRequest.findFirst.mockResolvedValue(listed());

        await refundService.getRefundRequestForSeller('shop-1', 'req-1');

        expect(refundPrisma.refundRequest.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'req-1',
              shopId: 'shop-1',
              status: { not: 'WITHDRAWN' },
              order: {
                status: { in: VISIBLE },
                statusHistory: { some: { toStatus: 'PENDING' } },
              },
            },
          }),
        );
      });

      it('yêu cầu của shop khác / đơn bị ẩn / đã rút / không tồn tại — cùng 404 REFUND_REQUEST_NOT_FOUND', async () => {
        refundPrisma.refundRequest.findFirst.mockResolvedValue(null);

        await expectAppException(
          refundService.getRefundRequestForSeller('shop-1', 'x'),
          {
            status: 404,
            code: 'REFUND_REQUEST_NOT_FOUND',
            message: 'Refund request not found',
          },
        );
      });
    });
  });
});
