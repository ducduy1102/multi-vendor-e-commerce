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
    user: { email: 'buyer@example.com', name: 'Nguyễn Văn A' },
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
  let prisma: { order: { findMany: jest.Mock } };
  let mail: {
    sendOrderPlaced: jest.Mock;
    sendOrderConfirmed: jest.Mock;
    sendOrderShipped: jest.Mock;
    sendOrderCancelled: jest.Mock;
  };

  beforeEach(() => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } };
    mail = {
      sendOrderPlaced: jest.fn().mockResolvedValue(undefined),
      sendOrderConfirmed: jest.fn().mockResolvedValue(undefined),
      sendOrderShipped: jest.fn().mockResolvedValue(undefined),
      sendOrderCancelled: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrderEmailService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
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
});
