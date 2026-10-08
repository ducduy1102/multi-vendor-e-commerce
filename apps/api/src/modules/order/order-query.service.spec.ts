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
        canReject: false,
        canCancel: false,
      });
    });

    it('cờ hành động theo status + phương thức: COD chờ xác nhận được từ chối', async () => {
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
      expect(byId.online).toMatchObject({ canConfirm: true, canReject: false });
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
          refundRequests: [{ kind: 'CANCEL', status: 'PENDING_SELLER' }],
        }),
        sellerLoaded({
          id: 'blocked-ship',
          status: 'PACKED',
          refundRequests: [{ kind: 'CANCEL', status: 'ESCALATED' }],
        }),
        sellerLoaded({
          id: 'rejected',
          status: 'CONFIRMED',
          refundRequests: [{ kind: 'CANCEL', status: 'REJECTED_BY_SELLER' }],
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

    it('chỉ select kind + status của yêu cầu chưa rút (không đọc lý do/ghi chú của người mua ở danh sách)', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.listForSeller('shop-1', query);

      const calls = prisma.order.findMany.mock.calls as [
        { select: Record<string, unknown> },
      ][];
      const arg = calls[0][0];
      expect(arg.select.refundRequests).toEqual({
        where: { status: { not: 'WITHDRAWN' } },
        select: { kind: true, status: true },
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
});
