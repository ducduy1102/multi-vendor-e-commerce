import { Test } from '@nestjs/testing';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentModule } from './payment.module';
import { VnpayProvider } from './vnpay.provider';

const ENV_KEYS = [
  'NODE_ENV',
  'PAYMENT_MOCK_ENABLED',
  'VNPAY_TMN_CODE',
  'VNPAY_HASH_SECRET',
  'VNPAY_MIN_AMOUNT',
  'VNPAY_MAX_AMOUNT',
];

describe('PaymentGatewayService', () => {
  const saved: Record<string, string | undefined> = {};
  let service: PaymentGatewayService;
  const setEnv = (key: string, value: string) => {
    (process.env as Record<string, string | undefined>)[key] = value;
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    setEnv('NODE_ENV', 'test');
    service = new PaymentGatewayService(
      new VnpayProvider(),
      new MockPaymentProvider(),
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else setEnv(key, saved[key]);
    }
  });

  const configureVnpay = () => {
    setEnv('VNPAY_TMN_CODE', 'TESTCODE');
    setEnv('VNPAY_HASH_SECRET', 'secret');
  };

  it('PaymentModule dựng được qua DI và không throw khi thiếu mọi ENV', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentModule],
    }).compile();

    expect(moduleRef.get(PaymentGatewayService)).toBeInstanceOf(
      PaymentGatewayService,
    );
  });

  describe('chọn cổng', () => {
    it('VNPAY → VnpayProvider; MOMO → null (chưa làm, không chặn nghiệm thu Tuần 7)', () => {
      expect(service.get('VNPAY')).toBeInstanceOf(VnpayProvider);
      expect(service.get('MOMO')).toBeNull();
    });

    it('mock bật (ngoài production) thay MỌI phương thức', () => {
      setEnv('PAYMENT_MOCK_ENABLED', 'true');

      expect(service.get('VNPAY')).toBeInstanceOf(MockPaymentProvider);
      expect(service.get('MOMO')).toBeInstanceOf(MockPaymentProvider);
    });

    it('mock KHÔNG BAO GIỜ được chọn ở production dù cờ ENV bật nhầm', () => {
      setEnv('PAYMENT_MOCK_ENABLED', 'true');
      setEnv('NODE_ENV', 'production');

      expect(service.get('VNPAY')).toBeInstanceOf(VnpayProvider);
      expect(service.get('MOMO')).toBeNull();
    });

    it('getConfigured: null nếu cổng chưa đủ cấu hình', () => {
      expect(service.getConfigured('VNPAY')).toBeNull();
      configureVnpay();
      expect(service.getConfigured('VNPAY')).toBeInstanceOf(VnpayProvider);
    });
  });

  describe('getAvailability — BE quyết định phương thức khả dụng', () => {
    it('chưa cấu hình gì: mọi phương thức NOT_CONFIGURED', () => {
      expect(service.getAvailability(100_000)).toEqual([
        { method: 'VNPAY', available: false, reason: 'NOT_CONFIGURED' },
        { method: 'MOMO', available: false, reason: 'NOT_CONFIGURED' },
        { method: 'COD', available: false, reason: 'NOT_CONFIGURED' },
      ]);
    });

    it('VNPay đã cấu hình: khả dụng, MoMo vẫn NOT_CONFIGURED', () => {
      configureVnpay();

      expect(service.getAvailability(100_000)).toEqual([
        { method: 'VNPAY', available: true },
        { method: 'MOMO', available: false, reason: 'NOT_CONFIGURED' },
        { method: 'COD', available: false, reason: 'NOT_CONFIGURED' },
      ]);
    });

    it.each([
      [999, 'AMOUNT_TOO_SMALL'],
      [1000, undefined],
      [9_999_999_999, undefined],
      [10_000_000_000, 'AMOUNT_TOO_LARGE'],
    ])('số tiền %i → %s (sàn/trần theo phương thức)', (amount, reason) => {
      configureVnpay();

      const vnpay = service.availabilityOf('VNPAY', amount);

      expect(vnpay.available).toBe(reason === undefined);
      expect(vnpay.reason).toBe(reason);
    });

    it('sàn/trần lấy từ ENV', () => {
      configureVnpay();
      setEnv('VNPAY_MIN_AMOUNT', '20000');
      setEnv('VNPAY_MAX_AMOUNT', '50000000');

      expect(service.availabilityOf('VNPAY', 19_999).reason).toBe(
        'AMOUNT_TOO_SMALL',
      );
      expect(service.availabilityOf('VNPAY', 50_000_001).reason).toBe(
        'AMOUNT_TOO_LARGE',
      );
      expect(service.availabilityOf('VNPAY', 50_000_000).available).toBe(true);
    });

    it('COD luôn không khả dụng cho tới khi placeOrder hỗ trợ (Week8.md 2.7), kể cả khi mock bật', () => {
      setEnv('PAYMENT_MOCK_ENABLED', 'true');

      expect(service.availabilityOf('COD', 100_000)).toEqual({
        method: 'COD',
        available: false,
        reason: 'NOT_CONFIGURED',
      });
    });

    it('mock bật: mọi phương thức có cổng khả dụng không cần khoá (để chạy Playwright)', () => {
      setEnv('PAYMENT_MOCK_ENABLED', 'true');

      expect(
        service
          .getAvailability(100_000)
          .filter((m) => m.method !== 'COD')
          .every((m) => m.available),
      ).toBe(true);
    });

    it('production + mock bật nhầm + chưa có khoá VNPay: không phương thức nào khả dụng', () => {
      setEnv('PAYMENT_MOCK_ENABLED', 'true');
      setEnv('NODE_ENV', 'production');

      expect(service.getAvailability(100_000).some((m) => m.available)).toBe(
        false,
      );
    });
  });
});
