import { Prisma } from '@prisma/client';
import type { MailService } from '../../shared/mail/mail.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OrderEmailService } from './order-email.service';

const D = (n: number) => new Prisma.Decimal(n);

function emailOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    totalAmount: D(220_000),
    discountAmount: D(0),
    shippingFee: D(20_000),
    recipientName: 'Nguyễn Văn A',
    recipientPhone: '0912345678',
    shippingAddressLine: '12 Nguyễn Huệ',
    shippingWard: 'Phường Bến Nghé',
    shippingProvince: 'Hồ Chí Minh',
    carrier: null,
    trackingCode: null,
    user: { email: 'buyer@example.com', name: 'Nguyễn Văn A', locale: 'vi' },
    shop: { name: 'Shop Áo Xinh' },
    items: [
      {
        productName: 'Áo thun',
        variantLabel: 'Đỏ / M',
        quantity: 2,
        priceAtPurchase: D(100_000),
      },
    ],
    checkoutGroup: { payments: [{ method: 'VNPAY' }] },
    ...overrides,
  };
}

describe('OrderEmailService', () => {
  let service: OrderEmailService;
  let prisma: {
    order: { findMany: jest.Mock };
    orderItem: { findMany: jest.Mock };
    review: { findMany: jest.Mock };
    refundRequest: { findUnique: jest.Mock };
  };
  let mail: {
    sendOrderPlaced: jest.Mock;
    sendOrderConfirmed: jest.Mock;
    sendOrderShipped: jest.Mock;
    sendOrderCancelled: jest.Mock;
    sendOrderRefunded: jest.Mock;
    sendOrderCompleted: jest.Mock;
    sendRefundRequestRejected: jest.Mock;
  };

  beforeEach(() => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      // Hai sản phẩm trong đơn (theo variant); chưa có đánh giá nào.
      orderItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { productVariant: { productId: 'p1' } },
            { productVariant: { productId: 'p2' } },
          ]),
      },
      review: { findMany: jest.fn().mockResolvedValue([]) },
      refundRequest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    mail = {
      sendOrderPlaced: jest.fn().mockResolvedValue(undefined),
      sendOrderConfirmed: jest.fn().mockResolvedValue(undefined),
      sendOrderShipped: jest.fn().mockResolvedValue(undefined),
      sendOrderCancelled: jest.fn().mockResolvedValue(undefined),
      sendOrderRefunded: jest.fn().mockResolvedValue(undefined),
      sendOrderCompleted: jest.fn().mockResolvedValue(undefined),
      sendRefundRequestRejected: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrderEmailService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.REFUND_WINDOW_DAYS;
    delete process.env.REFUND_ESCALATE_DAYS;
  });

  describe('notifyPlaced', () => {
    it('đọc MỌI đơn của nhóm, gửi 1 email gộp tới buyer với địa chỉ giao và phương thức thanh toán', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({ id: 'aaaaaaaa-1' }),
        emailOrder({ id: 'bbbbbbbb-2', shop: { name: 'Shop B' } }),
      ]);

      await service.notifyPlaced('group-1');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { checkoutGroupId: 'group-1' } }),
      );
      expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);
      const [to, data] = mail.sendOrderPlaced.mock.calls[0] as [
        string,
        {
          buyerName: string;
          ordersUrl: string;
          paymentMethod: string;
          recipient: { name: string; phone: string; address: string };
          orders: Array<{
            orderCode: string;
            shopName: string;
            totalAmount: number;
          }>;
        },
      ];
      expect(to).toBe('buyer@example.com');
      expect(data).toMatchObject({
        buyerName: 'Nguyễn Văn A',
        ordersUrl: 'http://localhost:3000/orders',
        paymentMethod: 'VNPAY',
        recipient: {
          name: 'Nguyễn Văn A',
          phone: '0912345678',
          address: '12 Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh',
        },
      });
      expect(data.orders.map((o) => o.orderCode)).toEqual([
        'AAAAAAAA',
        'BBBBBBBB',
      ]);
      expect(data.orders[0]).toMatchObject({
        shopName: 'Shop Áo Xinh',
        totalAmount: 220_000,
      });
    });

    it('đơn COD — truyền paymentMethod COD để email nói "thanh toán khi nhận hàng"', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({ checkoutGroup: { payments: [{ method: 'COD' }] } }),
      ]);

      await service.notifyPlaced('group-1');

      const [, data] = mail.sendOrderPlaced.mock.calls[0] as [
        string,
        { paymentMethod: string },
      ];
      expect(data.paymentMethod).toBe('COD');
    });

    it('nhóm không có đơn nào — không gửi gì', async () => {
      await service.notifyPlaced('group-trong');

      expect(mail.sendOrderPlaced).not.toHaveBeenCalled();
    });
  });

  describe('notifyConfirmed / notifyShipped', () => {
    it('notifyConfirmed: link trỏ thẳng tới đơn đó', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyConfirmed('order-1');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' } }),
      );
      const [to, data] = mail.sendOrderConfirmed.mock.calls[0] as [
        string,
        { ordersUrl: string; order: { shopName: string } },
      ];
      expect(to).toBe('buyer@example.com');
      expect(data.ordersUrl).toBe('http://localhost:3000/orders/order-1');
      expect(data.order.shopName).toBe('Shop Áo Xinh');
    });

    it('notifyShipped: mang theo đơn vị vận chuyển và mã vận đơn đã lưu', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({ carrier: 'GHN', trackingCode: 'GHN123' }),
      ]);

      await service.notifyShipped('order-1');

      const [, data] = mail.sendOrderShipped.mock.calls[0] as [
        string,
        { carrier: string; trackingCode: string },
      ];
      expect(data).toMatchObject({ carrier: 'GHN', trackingCode: 'GHN123' });
    });

    it('đơn không còn tồn tại — không gửi, không lỗi', async () => {
      await service.notifyConfirmed('order-ma');
      await service.notifyShipped('order-ma');

      expect(mail.sendOrderConfirmed).not.toHaveBeenCalled();
      expect(mail.sendOrderShipped).not.toHaveBeenCalled();
    });
  });

  describe('notifyCancelled', () => {
    it('theo danh sách đơn: chỉ lấy đơn ĐÃ CANCELLED, báo đúng người hủy và lý do', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder({ id: 'o-1' })]);

      await service.notifyCancelled(
        { orderIds: ['o-1'] },
        'SELLER',
        'Hết hàng',
      );

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['o-1'] }, status: 'CANCELLED' },
        }),
      );
      const [, data] = mail.sendOrderCancelled.mock.calls[0] as [
        string,
        { cancelledBy: string; reason: string; ordersUrl: string },
      ];
      expect(data).toMatchObject({
        cancelledBy: 'SELLER',
        reason: 'Hết hàng',
        ordersUrl: 'http://localhost:3000/orders/o-1',
      });
    });

    it('theo nhóm: lấy các đơn CANCELLED của nhóm, 1 email gộp, link tới danh sách đơn', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({ id: 'o-1' }),
        emailOrder({ id: 'o-2' }),
      ]);

      await service.notifyCancelled({ checkoutGroupId: 'g1' }, 'SYSTEM');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { checkoutGroupId: 'g1', status: 'CANCELLED' },
        }),
      );
      expect(mail.sendOrderCancelled).toHaveBeenCalledTimes(1);
      const [, data] = mail.sendOrderCancelled.mock.calls[0] as [
        string,
        {
          cancelledBy: string;
          reason: null;
          ordersUrl: string;
          orders: unknown[];
        },
      ];
      expect(data).toMatchObject({
        cancelledBy: 'SYSTEM',
        reason: null,
        ordersUrl: 'http://localhost:3000/orders',
      });
      expect(data.orders).toHaveLength(2);
    });

    it('không có đơn nào đã hủy — không gửi', async () => {
      await service.notifyCancelled({ checkoutGroupId: 'g1' }, 'SYSTEM');

      expect(mail.sendOrderCancelled).not.toHaveBeenCalled();
    });

    it('hủy kèm hoàn tiền (Week9.md 1.5): chuyển số tiền ĐANG hoàn vào email; mặc định là null (không hoàn)', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder({ id: 'o-1' })]);

      await service.notifyCancelled(
        { orderIds: ['o-1'] },
        'BUYER',
        null,
        410_000,
      );
      await service.notifyCancelled({ orderIds: ['o-1'] }, 'BUYER');

      const calls = mail.sendOrderCancelled.mock.calls as [
        string,
        { refundAmount: number | null },
      ][];
      expect(calls[0][1].refundAmount).toBe(410_000);
      expect(calls[1][1].refundAmount).toBeNull();
    });
  });

  describe('notifyCompleted (đơn đã hoàn tất, Week10.md 7.5)', () => {
    type CompletedData = {
      locale: string;
      completedBy: string;
      autoCompleteDays: number;
      returnWindowDays: number;
      invitesReview: boolean;
      ordersUrl: string;
      order: { shopName: string; orderCode: string };
    };
    const sent = () => {
      const [to, data] = mail.sendOrderCompleted.mock.calls[0] as [
        string,
        CompletedData,
      ];
      return { to, data };
    };

    it('người mua tự bấm: đọc đơn theo id, gửi email nhánh BUYER tới người mua, link trỏ thẳng tới đơn', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyCompleted('order-1', { by: 'BUYER' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' } }),
      );
      const { to, data } = sent();
      expect(to).toBe('buyer@example.com');
      expect(data).toMatchObject({
        completedBy: 'BUYER',
        autoCompleteDays: 0,
        ordersUrl: 'http://localhost:3000/orders/order-1',
        order: { shopName: 'Shop Áo Xinh', orderCode: 'ABCDEF12' },
      });
    });

    it('hệ thống tự hoàn tất: truyền số ngày đã chờ', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyCompleted('order-1', { by: 'SYSTEM', days: 7 });

      expect(sent().data).toMatchObject({
        completedBy: 'SYSTEM',
        autoCompleteDays: 7,
      });
    });

    it('cửa sổ trả hàng/hoàn tiền lấy từ cấu hình REFUND_WINDOW_DAYS', async () => {
      process.env.REFUND_WINDOW_DAYS = '10';
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyCompleted('order-1', { by: 'BUYER' });

      expect(sent().data.returnWindowDays).toBe(10);
    });

    describe('mời đánh giá chỉ khi còn sản phẩm chưa được đánh giá', () => {
      beforeEach(() => {
        prisma.order.findMany.mockResolvedValue([emailOrder()]);
      });

      it('chưa đánh giá sản phẩm nào ⇒ mời', async () => {
        await service.notifyCompleted('order-1', { by: 'BUYER' });

        expect(sent().data.invitesReview).toBe(true);
        expect(prisma.review.findMany).toHaveBeenCalledWith({
          where: { orderId: 'order-1' },
          select: { productId: true },
        });
        expect(prisma.orderItem.findMany).toHaveBeenCalledWith({
          where: { orderId: 'order-1' },
          select: { productVariant: { select: { productId: true } } },
        });
      });

      it('mới đánh giá một trong hai sản phẩm ⇒ vẫn mời', async () => {
        prisma.review.findMany.mockResolvedValue([{ productId: 'p1' }]);

        await service.notifyCompleted('order-1', { by: 'BUYER' });

        expect(sent().data.invitesReview).toBe(true);
      });

      it('đã đánh giá mọi sản phẩm ⇒ KHÔNG mời', async () => {
        prisma.review.findMany.mockResolvedValue([
          { productId: 'p1' },
          { productId: 'p2' },
        ]);

        await service.notifyCompleted('order-1', { by: 'BUYER' });

        expect(sent().data.invitesReview).toBe(false);
      });

      it('hai dòng hàng của cùng một sản phẩm (khác biến thể) chỉ cần MỘT đánh giá', async () => {
        prisma.orderItem.findMany.mockResolvedValue([
          { productVariant: { productId: 'p1' } },
          { productVariant: { productId: 'p1' } },
        ]);
        prisma.review.findMany.mockResolvedValue([{ productId: 'p1' }]);

        await service.notifyCompleted('order-1', { by: 'BUYER' });

        expect(sent().data.invitesReview).toBe(false);
      });
    });

    it('buyer en: email mang locale en và link có prefix /en', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({
          user: { email: 'b@x.com', name: 'John', locale: 'en' },
        }),
      ]);

      await service.notifyCompleted('order-1', { by: 'BUYER' });

      expect(sent().data).toMatchObject({
        locale: 'en',
        ordersUrl: 'http://localhost:3000/en/orders/order-1',
      });
    });

    it('đơn không còn tồn tại — không gửi, không đọc đánh giá, không lỗi', async () => {
      await expect(
        service.notifyCompleted('order-ma', { by: 'BUYER' }),
      ).resolves.toBeUndefined();

      expect(mail.sendOrderCompleted).not.toHaveBeenCalled();
      expect(prisma.review.findMany).not.toHaveBeenCalled();
    });

    it('KHÔNG BAO GIỜ ném: provider mail lỗi, đọc đơn lỗi, đọc đánh giá lỗi', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);
      mail.sendOrderCompleted.mockRejectedValue(new Error('Resend down'));
      await expect(
        service.notifyCompleted('order-1', { by: 'BUYER' }),
      ).resolves.toBeUndefined();

      mail.sendOrderCompleted.mockClear();
      prisma.review.findMany.mockRejectedValue(new Error('db timeout'));
      await expect(
        service.notifyCompleted('order-1', { by: 'BUYER' }),
      ).resolves.toBeUndefined();
      expect(mail.sendOrderCompleted).not.toHaveBeenCalled();

      prisma.order.findMany.mockRejectedValue(new Error('db down'));
      await expect(
        service.notifyCompleted('order-1', { by: 'SYSTEM', days: 7 }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyRefundRequestRejected (yêu cầu bị từ chối, Week10.md 7.5)', () => {
    type RejectedData = {
      locale: string;
      kind: string;
      rejectedBy: string;
      reason: string | null;
      escalateDays: number | null;
      ordersUrl: string;
      order: { shopName: string };
    };
    const request = (overrides: Record<string, unknown> = {}) => ({
      kind: 'RETURN',
      order: emailOrder(),
      ...overrides,
    });
    const sent = () => {
      const [to, data] = mail.sendRefundRequestRejected.mock.calls[0] as [
        string,
        RejectedData,
      ];
      return { to, data };
    };

    it('shop từ chối: đọc yêu cầu theo id, gửi tới người mua kèm lý do và số ngày còn khiếu nại được', async () => {
      process.env.REFUND_ESCALATE_DAYS = '5';
      prisma.refundRequest.findUnique.mockResolvedValue(request());

      await service.notifyRefundRequestRejected(
        'req-1',
        'SELLER',
        'Hàng đã qua sử dụng',
      );

      expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1' } }),
      );
      const { to, data } = sent();
      expect(to).toBe('buyer@example.com');
      expect(data).toMatchObject({
        kind: 'RETURN',
        rejectedBy: 'SELLER',
        reason: 'Hàng đã qua sử dụng',
        escalateDays: 5,
        ordersUrl:
          'http://localhost:3000/orders/abcdef12-3456-7890-abcd-ef1234567890',
        order: { shopName: 'Shop Áo Xinh' },
      });
    });

    it('Admin từ chối: quyết định cuối nên không có số ngày khiếu nại', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(request());

      await service.notifyRefundRequestRejected(
        'req-1',
        'ADMIN',
        'Không đủ điều kiện',
      );

      expect(sent().data).toMatchObject({
        rejectedBy: 'ADMIN',
        escalateDays: null,
        reason: 'Không đủ điều kiện',
      });
    });

    it.each([[undefined], [null], [''], ['   ']])(
      'lý do %j ⇒ gửi với reason null (không bịa lý do)',
      async (reason) => {
        prisma.refundRequest.findUnique.mockResolvedValue(request());

        await service.notifyRefundRequestRejected('req-1', 'SELLER', reason);

        expect(sent().data.reason).toBeNull();
      },
    );

    it('lý do được cắt khoảng trắng hai đầu', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(request());

      await service.notifyRefundRequestRejected(
        'req-1',
        'SELLER',
        '  Hết hạn  ',
      );

      expect(sent().data.reason).toBe('Hết hạn');
    });

    it('yêu cầu HỦY: truyền đúng loại', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        request({ kind: 'CANCEL' }),
      );

      await service.notifyRefundRequestRejected('req-1', 'SELLER', 'x');

      expect(sent().data.kind).toBe('CANCEL');
    });

    it('buyer en: email mang locale en và link có prefix /en', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(
        request({
          order: emailOrder({
            user: { email: 'b@x.com', name: 'John', locale: 'en' },
          }),
        }),
      );

      await service.notifyRefundRequestRejected('req-1', 'SELLER', 'x');

      expect(sent().data.locale).toBe('en');
      expect(sent().data.ordersUrl).toContain(
        'http://localhost:3000/en/orders/',
      );
    });

    it('yêu cầu không còn tồn tại — không gửi, không lỗi', async () => {
      await expect(
        service.notifyRefundRequestRejected('req-ma', 'SELLER', 'x'),
      ).resolves.toBeUndefined();

      expect(mail.sendRefundRequestRejected).not.toHaveBeenCalled();
    });

    it('KHÔNG BAO GIỜ ném: provider mail lỗi hoặc đọc DB lỗi', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(request());
      mail.sendRefundRequestRejected.mockRejectedValue(
        new Error('Resend down'),
      );
      await expect(
        service.notifyRefundRequestRejected('req-1', 'SELLER', 'x'),
      ).resolves.toBeUndefined();

      prisma.refundRequest.findUnique.mockRejectedValue(new Error('db down'));
      await expect(
        service.notifyRefundRequestRejected('req-1', 'ADMIN', 'x'),
      ).resolves.toBeUndefined();
    });
  });

  describe('KHÔNG BAO GIỜ ném lỗi (DB đã commit — mail lỗi chỉ được log)', () => {
    it.each([
      ['notifyPlaced', (s: OrderEmailService) => s.notifyPlaced('g1')],
      ['notifyConfirmed', (s: OrderEmailService) => s.notifyConfirmed('o1')],
      ['notifyShipped', (s: OrderEmailService) => s.notifyShipped('o1')],
      [
        'notifyCancelled',
        (s: OrderEmailService) =>
          s.notifyCancelled({ orderIds: ['o1'] }, 'BUYER'),
      ],
    ])('%s: provider mail lỗi — resolve bình thường', async (_name, call) => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);
      for (const fn of Object.values(mail)) {
        fn.mockRejectedValue(new Error('Resend down'));
      }

      await expect(call(service)).resolves.toBeUndefined();
    });

    it.each([
      ['notifyPlaced', (s: OrderEmailService) => s.notifyPlaced('g1')],
      ['notifyConfirmed', (s: OrderEmailService) => s.notifyConfirmed('o1')],
      ['notifyShipped', (s: OrderEmailService) => s.notifyShipped('o1')],
      [
        'notifyCancelled',
        (s: OrderEmailService) =>
          s.notifyCancelled({ orderIds: ['o1'] }, 'BUYER'),
      ],
    ])(
      '%s: đọc DB lỗi — resolve bình thường, không gửi gì',
      async (_name, call) => {
        prisma.order.findMany.mockRejectedValue(new Error('db timeout'));

        await expect(call(service)).resolves.toBeUndefined();
        for (const fn of Object.values(mail)) {
          expect(fn).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('ngôn ngữ email theo User.locale (Week9.md 1.12)', () => {
    const enUser = {
      email: 'buyer@example.com',
      name: 'John',
      locale: 'en',
    };

    it('đọc locale của buyer ở cùng truy vấn (không thêm truy vấn)', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyConfirmed('order-1');

      expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
      const [args] = prisma.order.findMany.mock.calls[0] as [
        { select: { user: unknown } },
      ];
      expect(args.select.user).toEqual({
        select: { email: true, name: true, locale: true },
      });
    });

    it('buyer en: email mang locale en và link có prefix /en', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder({ user: enUser })]);

      await service.notifyConfirmed('order-1');

      const [, data] = mail.sendOrderConfirmed.mock.calls[0] as [
        string,
        { locale: string; ordersUrl: string },
      ];
      expect(data.locale).toBe('en');
      expect(data.ordersUrl).toBe('http://localhost:3000/en/orders/order-1');
    });

    it('buyer vi: link KHÔNG có prefix (localePrefix as-needed của FE)', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyConfirmed('order-1');

      const [, data] = mail.sendOrderConfirmed.mock.calls[0] as [
        string,
        { locale: string; ordersUrl: string },
      ];
      expect(data.locale).toBe('vi');
      expect(data.ordersUrl).toBe('http://localhost:3000/orders/order-1');
    });

    it.each([
      [
        'notifyPlaced',
        'sendOrderPlaced',
        (s: OrderEmailService) => s.notifyPlaced('g1'),
      ],
      [
        'notifyShipped',
        'sendOrderShipped',
        (s: OrderEmailService) => s.notifyShipped('o1'),
      ],
      [
        'notifyCancelled',
        'sendOrderCancelled',
        (s: OrderEmailService) =>
          s.notifyCancelled({ orderIds: ['o1'] }, 'SELLER'),
      ],
      [
        'notifyRefunded',
        'sendOrderRefunded',
        (s: OrderEmailService) => s.notifyRefunded('o1'),
      ],
    ] as const)(
      '%s: truyền locale en của buyer cho template',
      async (_name, sender, call) => {
        prisma.order.findMany.mockResolvedValue([emailOrder({ user: enUser })]);

        await call(service);

        const [, data] = mail[sender].mock.calls[0] as [
          string,
          { locale: string; ordersUrl: string },
        ];
        expect(data.locale).toBe('en');
        expect(data.ordersUrl).toMatch(/^http:\/\/localhost:3000\/en\/orders/);
      },
    );
  });

  describe('notifyRefunded (duyệt trả hàng sau giao)', () => {
    it('đơn đã trả online: hoàn về phương thức ban đầu, số tiền là khoản hoàn qua cổng', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);

      await service.notifyRefunded('order-1', 200_000);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' } }),
      );
      const [to, data] = mail.sendOrderRefunded.mock.calls[0] as [
        string,
        {
          refundAmount: number;
          refundTo: string;
          ordersUrl: string;
          order: { shopName: string };
        },
      ];
      expect(to).toBe('buyer@example.com');
      expect(data.refundAmount).toBe(200_000);
      expect(data.refundTo).toBe('ORIGINAL_PAYMENT');
      expect(data.ordersUrl).toBe('http://localhost:3000/orders/order-1');
      expect(data.order.shopName).toBe('Shop Áo Xinh');
    });

    it('đơn COD: shop hoàn tiền mặt, số tiền lấy từ tổng đơn khi không có khoản hoàn qua cổng', async () => {
      prisma.order.findMany.mockResolvedValue([
        emailOrder({
          totalAmount: D(310_000),
          checkoutGroup: { payments: [{ method: 'COD' }] },
        }),
      ]);

      await service.notifyRefunded('order-1', null);

      const [, data] = mail.sendOrderRefunded.mock.calls[0] as [
        string,
        { refundAmount: number; refundTo: string },
      ];
      expect(data.refundTo).toBe('SHOP_CASH');
      expect(data.refundAmount).toBe(310_000);
    });

    it('không có đơn — không gửi gì', async () => {
      await service.notifyRefunded('order-khong-co', 1);

      expect(mail.sendOrderRefunded).not.toHaveBeenCalled();
    });

    it('provider mail lỗi — resolve bình thường (DB đã xong việc của nó)', async () => {
      prisma.order.findMany.mockResolvedValue([emailOrder()]);
      mail.sendOrderRefunded.mockRejectedValue(new Error('Resend down'));

      await expect(
        service.notifyRefunded('order-1', 1),
      ).resolves.toBeUndefined();
    });
  });
});
