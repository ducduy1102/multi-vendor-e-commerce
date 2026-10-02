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
    const base = { buyerName: 'An', ordersUrl: 'http://localhost:3000/orders' };

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
});
