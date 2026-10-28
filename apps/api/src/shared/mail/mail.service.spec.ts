import { Test } from '@nestjs/testing';
import {
  MAIL_PROVIDER,
  type MailMessage,
  type MailProvider,
} from './mail-provider.interface';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let provider: { send: jest.Mock<Promise<void>, [MailMessage]> };

  beforeEach(async () => {
    provider = {
      send: jest
        .fn<Promise<void>, [MailMessage]>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_PROVIDER, useValue: provider as MailProvider },
      ],
    }).compile();

    service = moduleRef.get(MailService);
  });

  describe('email đơn hàng (Week8.md 2.8)', () => {
    const order = {
      orderCode: 'AB12CD34',
      shopName: 'Shop A',
      items: [
        {
          productName: 'Áo',
          variantLabel: null,
          quantity: 1,
          unitPrice: 100_000,
        },
      ],
      shippingFee: 20_000,
      discountAmount: 0,
      totalAmount: 120_000,
    };
    const base = {
      locale: 'vi' as const,
      buyerName: 'An',
      ordersUrl: 'http://localhost:3000/orders',
    };

    it('sendOrderPlaced / Confirmed / Shipped / Cancelled: gọi provider đúng 1 lần với người nhận + subject + html', async () => {
      await service.sendOrderPlaced('a@x.com', {
        ...base,
        orders: [order],
        paymentMethod: 'COD',
        recipient: { name: 'An', phone: '0900000000', address: 'x' },
      });
      await service.sendOrderConfirmed('b@x.com', { ...base, order });
      await service.sendOrderShipped('c@x.com', {
        ...base,
        order,
        carrier: 'GHN',
        trackingCode: 'T1',
      });
      await service.sendOrderCancelled('d@x.com', {
        ...base,
        orders: [order],
        cancelledBy: 'BUYER',
        reason: null,
      });

      expect(provider.send).toHaveBeenCalledTimes(4);
      const calls = provider.send.mock.calls.map(([m]) => m);
      expect(calls.map((m) => m.to)).toEqual([
        'a@x.com',
        'b@x.com',
        'c@x.com',
        'd@x.com',
      ]);
      for (const message of calls) {
        expect(message.subject.length).toBeGreaterThan(0);
        expect(message.html).toContain('#AB12CD34');
      }
    });

    it('lỗi của provider được ném lại cho người gọi (OrderEmailService mới là nơi bắt)', async () => {
      provider.send.mockRejectedValue(new Error('Resend down'));

      await expect(
        service.sendOrderConfirmed('b@x.com', { ...base, order }),
      ).rejects.toThrow('Resend down');
    });
  });

  describe('sendVerificationEmail', () => {
    it('gọi provider.send với subject/html chứa link verify, không lộ chi tiết provider ra ngoài', async () => {
      await service.sendVerificationEmail(
        'user@example.com',
        'Nguyen Van A',
        'http://localhost:3000/verify-email?token=abc123',
        'vi',
      );

      expect(provider.send).toHaveBeenCalledTimes(1);
      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('user@example.com');
      expect(message.subject).toEqual(expect.any(String));
      expect(message.html).toContain(
        'http://localhost:3000/verify-email?token=abc123',
      );
      expect(message.html).toContain('Nguyen Van A');
    });
  });

  describe('sendVerificationEmail theo ngôn ngữ', () => {
    it('en: tiêu đề tiếng Anh, link giữ nguyên', async () => {
      await service.sendVerificationEmail(
        'user@example.com',
        'John',
        'http://localhost:3000/en/verify-email?token=abc123',
        'en',
      );

      const message = provider.send.mock.calls[0][0];
      expect(message.subject).toBe('Verify your email');
      expect(message.html).toContain('Hi John,');
      expect(message.html).toContain(
        'http://localhost:3000/en/verify-email?token=abc123',
      );
    });
  });

  describe('email tài khoản và trạng thái shop (Week9.md 1.11–1.13)', () => {
    it('sendPasswordReset: gửi đúng người nhận, đúng ngôn ngữ, có link đặt lại', async () => {
      await service.sendPasswordReset('a@x.com', {
        locale: 'en',
        name: 'John',
        resetUrl: 'http://localhost:3000/en/reset-password?token=tok',
        expiresInMinutes: 60,
      });

      expect(provider.send).toHaveBeenCalledTimes(1);
      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('a@x.com');
      expect(message.subject).toBe('Reset your password');
      expect(message.html).toContain('reset-password?token=tok');
    });

    it('sendPasswordChanged: email bảo mật, không có token', async () => {
      await service.sendPasswordChanged('a@x.com', {
        locale: 'vi',
        name: 'An',
        forgotPasswordUrl: 'http://localhost:3000/forgot-password',
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('a@x.com');
      expect(message.subject).toBe('Mật khẩu của bạn đã được thay đổi');
      expect(message.html).toContain('/forgot-password');
    });

    it('sendShopStatusChanged: tiêu đề theo loại, lý do có trong nội dung', async () => {
      await service.sendShopStatusChanged('owner@x.com', {
        locale: 'vi',
        ownerName: 'An',
        shopName: 'Shop A',
        kind: 'SUSPENDED',
        reason: 'Vi phạm chính sách',
        shopUrl: 'http://localhost:3000/seller/shop',
        supportEmail: 'support@example.com',
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('owner@x.com');
      expect(message.subject).toBe('Shop Shop A đã bị tạm khoá');
      expect(message.html).toContain('Vi phạm chính sách');
      expect(message.html).toContain('Liên hệ hỗ trợ');
      expect(message.html).toContain('support@example.com');
    });

    it('sendAccountStatusChanged: gửi đúng người, tiêu đề theo loại, lý do có trong nội dung', async () => {
      await service.sendAccountStatusChanged('user@x.com', {
        locale: 'vi',
        name: 'An',
        kind: 'BANNED',
        reason: 'Gian lận thanh toán',
        supportEmail: null,
        loginUrl: 'http://localhost:3000/login',
        shopNotice: null,
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('user@x.com');
      expect(message.subject).toBe('Tài khoản của bạn đã bị cấm');
      expect(message.html).toContain('Gian lận thanh toán');
    });

    it('sendOrderRefunded: nêu số tiền và mã đơn', async () => {
      await service.sendOrderRefunded('b@x.com', {
        locale: 'en',
        buyerName: 'John',
        ordersUrl: 'http://localhost:3000/en/orders/o1',
        order: {
          orderCode: 'AB12CD34',
          shopName: 'Shop A',
          items: [
            {
              productName: 'Shirt',
              variantLabel: null,
              quantity: 1,
              unitPrice: 100_000,
            },
          ],
          shippingFee: 20_000,
          discountAmount: 0,
          totalAmount: 120_000,
        },
        refundAmount: 120_000,
        refundTo: 'ORIGINAL_PAYMENT',
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('b@x.com');
      expect(message.subject).toBe('Your return request has been approved');
      expect(message.html).toContain('#AB12CD34');
      expect(message.html.replace(/\s/g, ' ')).toContain('120.000 ₫');
    });

    it('sendOrderCompleted: gửi tới người mua với tiêu đề có mã đơn', async () => {
      await service.sendOrderCompleted('b@x.com', {
        locale: 'en',
        buyerName: 'John',
        ordersUrl: 'http://localhost:3000/en/orders/o1',
        order: {
          orderCode: 'AB12CD34',
          shopName: 'Shop A',
          items: [
            {
              productName: 'Shirt',
              variantLabel: null,
              quantity: 1,
              unitPrice: 100_000,
            },
          ],
          shippingFee: 20_000,
          discountAmount: 0,
          totalAmount: 120_000,
        },
        completedBy: 'SYSTEM',
        autoCompleteDays: 7,
        returnWindowDays: 7,
        invitesReview: true,
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('b@x.com');
      expect(message.subject).toBe(
        'Order #AB12CD34 was completed automatically',
      );
      expect(message.html).toContain('within 7 days');
    });

    it('sendRefundRequestRejected: gửi tới người mua, lý do nằm trong thư', async () => {
      await service.sendRefundRequestRejected('b@x.com', {
        locale: 'vi',
        buyerName: 'An',
        ordersUrl: 'http://localhost:3000/orders/o1',
        order: {
          orderCode: 'AB12CD34',
          shopName: 'Shop A',
          items: [
            {
              productName: 'Áo',
              variantLabel: null,
              quantity: 1,
              unitPrice: 100_000,
            },
          ],
          shippingFee: 20_000,
          discountAmount: 0,
          totalAmount: 120_000,
        },
        kind: 'RETURN',
        rejectedBy: 'SELLER',
        reason: 'Hàng đã qua sử dụng',
        escalateDays: 3,
      });

      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe('b@x.com');
      expect(message.subject).toBe(
        'Shop đã từ chối yêu cầu trả hàng/hoàn tiền cho đơn #AB12CD34',
      );
      expect(message.html).toContain('Hàng đã qua sử dụng');
    });

    it('lỗi của provider được ném lại cho người gọi ở mọi hàm mới', async () => {
      provider.send.mockRejectedValue(new Error('Resend down'));

      await expect(
        service.sendPasswordReset('a@x.com', {
          locale: 'vi',
          name: 'An',
          resetUrl: 'http://localhost:3000/reset-password?token=t',
          expiresInMinutes: 60,
        }),
      ).rejects.toThrow('Resend down');
    });
  });

  describe('tiêu đề thư luôn là một dòng (chống chèn header)', () => {
    it('xuống dòng và ký tự điều khiển trong tên shop không lọt vào subject', async () => {
      await service.sendShopStatusChanged('owner@x.com', {
        locale: 'en',
        ownerName: 'An',
        shopName: 'Evil\r\nBcc: victim@example.com',
        kind: 'APPROVED',
        reason: null,
        shopUrl: 'http://localhost:3000/en/seller/shop',
        supportEmail: null,
      });

      const { subject } = provider.send.mock.calls[0][0];
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject).toBe(
        'Your shop Evil Bcc: victim@example.com has been approved',
      );
    });
  });
});
