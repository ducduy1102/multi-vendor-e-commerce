import { buildSignData, signVnpay } from './vnpay-signature';
import { VnpayProvider } from './vnpay.provider';

const SECRET = 'SECRETKEY123456789';
const ENV_KEYS = [
  'VNPAY_TMN_CODE',
  'VNPAY_HASH_SECRET',
  'VNPAY_PAY_URL',
  'VNPAY_MIN_AMOUNT',
  'VNPAY_MAX_AMOUNT',
];

// Chữ ký kỳ vọng tính ĐỘC LẬP bằng openssl (xem vnpay-signature.spec.ts) — không phải vector chính thức
// của VNPay; chữ ký thật của cổng chỉ xác nhận được khi thử sandbox có TmnCode thật.
const EXPECTED_PAY_URL =
  'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=25000000&vnp_Command=pay&vnp_CreateDate=20260927103000&vnp_CurrCode=VND&vnp_ExpireDate=20260927104500&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+don+hang+ABC123&vnp_OrderType=other&vnp_ReturnUrl=https%3A%2F%2Fapi.example.com%2Fapi%2Fv1%2Fpayments%2Fvnpay%2Freturn&vnp_TmnCode=TESTCODE&vnp_TxnRef=ABC123&vnp_Version=2.1.0&vnp_SecureHash=fde697fdcf4e7673c6eaf7afaa778727a0dfa77e137359052b84de9b6e520b91783473d4bc4342d0d937689254a6c4b7169c3fd6a78d593b4b9e79a6d608d8dc';

const createParams = {
  txnRef: 'ABC123',
  amountVnd: 250000,
  returnUrl: 'https://api.example.com/api/v1/payments/vnpay/return',
  expiresAt: new Date('2026-09-27T03:45:00Z'),
  clientIp: '127.0.0.1',
  locale: 'vi' as const,
};

// Callback thành công có chữ ký tính độc lập bằng openssl.
const SUCCESS_CALLBACK = {
  vnp_Amount: '1000000',
  vnp_BankCode: 'NCB',
  vnp_ResponseCode: '00',
  vnp_TmnCode: 'TESTCODE',
  vnp_TransactionNo: '14000001',
  vnp_TransactionStatus: '00',
  vnp_TxnRef: 'ABC123',
  vnp_SecureHash:
    '91112d7b88db8ccac53af0b4e947215aa5f8118d2467a3176d8116bfc204b9cd63f8072659faa46a33d9eae7feeb795de01846e188990ee9d59f3e93574fbc1c',
};

function signed(params: Record<string, string>): Record<string, string> {
  return {
    ...params,
    vnp_SecureHash: signVnpay(buildSignData(params), SECRET),
  };
}

describe('VnpayProvider', () => {
  const saved: Record<string, string | undefined> = {};
  let provider: VnpayProvider;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.VNPAY_TMN_CODE = 'TESTCODE';
    process.env.VNPAY_HASH_SECRET = SECRET;
    provider = new VnpayProvider();
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('constructor & cấu hình', () => {
    it('khởi tạo KHÔNG throw khi thiếu hết ENV (không sập app lúc bootstrap)', () => {
      for (const key of ENV_KEYS) delete process.env[key];
      expect(() => new VnpayProvider()).not.toThrow();
    });

    it('isConfigured: false khi thiếu TmnCode hoặc HashSecret, true khi đủ; không throw', () => {
      expect(provider.isConfigured()).toBe(true);
      delete process.env.VNPAY_HASH_SECRET;
      expect(provider.isConfigured()).toBe(false);
      process.env.VNPAY_HASH_SECRET = SECRET;
      delete process.env.VNPAY_TMN_CODE;
      expect(provider.isConfigured()).toBe(false);
    });

    it('ENV khai rỗng/toàn khoảng trắng (VAR=) coi như chưa cấu hình, không lọt qua bằng chuỗi rỗng', () => {
      process.env.VNPAY_TMN_CODE = '   ';
      expect(provider.isConfigured()).toBe(false);
    });

    it('VNPAY_PAY_URL để trống rơi về URL sandbox (`?.trim() || fallback`, không dùng ??)', async () => {
      process.env.VNPAY_PAY_URL = '';
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T03:30:00Z'));

      const { payUrl } = await provider.createPayment(createParams);

      expect(
        payUrl.startsWith(
          'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?',
        ),
      ).toBe(true);
    });

    it('thiếu cấu hình khi tạo thanh toán — reject, message không lộ khoá', async () => {
      delete process.env.VNPAY_HASH_SECRET;

      const error = await provider
        .createPayment(createParams)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('VNPay is not configured');
      expect((error as Error).message).not.toContain(SECRET);
    });
  });

  describe('createPayment', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T03:30:00Z'));
    });

    it('URL sinh ra khớp URL + chữ ký kỳ vọng (vector cố định)', async () => {
      const { payUrl } = await provider.createPayment(createParams);

      expect(payUrl).toBe(EXPECTED_PAY_URL);
    });

    it('tham số theo API 2.1.0, số tiền ×100 chỉ ở biên VNPay, ngày GMT+7, OrderInfo không dấu', async () => {
      const { payUrl } = await provider.createPayment(createParams);
      const q = new URL(payUrl).searchParams;

      expect(q.get('vnp_Version')).toBe('2.1.0');
      expect(q.get('vnp_Command')).toBe('pay');
      expect(q.get('vnp_CurrCode')).toBe('VND');
      expect(q.get('vnp_Amount')).toBe('25000000');
      expect(q.get('vnp_CreateDate')).toBe('20260927103000');
      expect(q.get('vnp_ExpireDate')).toBe('20260927104500');
      expect(q.get('vnp_OrderInfo')).toBe('Thanh toan don hang ABC123');
      expect(q.get('vnp_OrderInfo')).toMatch(/^[A-Za-z0-9 ]+$/);
      expect(q.get('vnp_ReturnUrl')).toBe(createParams.returnUrl);
      expect(q.get('vnp_TxnRef')).toBe('ABC123');
    });

    it('URL sinh ra tự xác thực được bằng verifyCallback (cùng thuật toán 2 chiều)', async () => {
      const { payUrl } = await provider.createPayment(createParams);
      const query = Object.fromEntries(new URL(payUrl).searchParams.entries());

      expect(provider.verifyCallback(query).isSignatureValid).toBe(true);
    });

    it('locale en → vnp_Locale=en; khác → vn', async () => {
      const en = new URL(
        (await provider.createPayment({ ...createParams, locale: 'en' }))
          .payUrl,
      );
      expect(en.searchParams.get('vnp_Locale')).toBe('en');
    });

    it.each([
      [undefined, '127.0.0.1'],
      ['', '127.0.0.1'],
      ['::1', '127.0.0.1'],
      ['abc', '127.0.0.1'],
      ['<script>', '127.0.0.1'],
      ['::ffff:203.0.113.5', '203.0.113.5'],
      ['203.0.113.5', '203.0.113.5'],
      ['2001:db8::1', '2001:db8::1'],
    ])('clientIp %p → %s', async (clientIp, expected) => {
      const { payUrl } = await provider.createPayment({
        ...createParams,
        clientIp,
      });

      expect(new URL(payUrl).searchParams.get('vnp_IpAddr')).toBe(expected);
    });

    it('hạn thanh toán không phụ thuộc múi giờ máy chủ', async () => {
      const original = process.env.TZ;
      try {
        process.env.TZ = 'America/Los_Angeles';
        const { payUrl } = await provider.createPayment(createParams);
        expect(payUrl).toBe(EXPECTED_PAY_URL);
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });

    describe('sàn/trần số tiền và đầu vào không hợp lệ bị từ chối TRƯỚC khi dựng URL', () => {
      it.each([
        ['dưới sàn mặc định (1.000)', 999],
        ['0', 0],
        ['âm', -1],
        ['không nguyên', 1000.5],
        ['NaN', NaN],
        ['vượt trần 12 chữ số của vnp_Amount', 10_000_000_000],
      ])('số tiền %s', async (_l, amountVnd) => {
        await expect(
          provider.createPayment({ ...createParams, amountVnd }),
        ).rejects.toThrow(RangeError);
      });

      it('đúng sàn và đúng trần vẫn hợp lệ (vnp_Amount ≤ 12 chữ số)', async () => {
        await expect(
          provider.createPayment({ ...createParams, amountVnd: 1000 }),
        ).resolves.toBeDefined();
        const max = await provider.createPayment({
          ...createParams,
          amountVnd: 9_999_999_999,
        });
        expect(new URL(max.payUrl).searchParams.get('vnp_Amount')).toBe(
          '999999999900',
        );
      });

      it('sàn/trần cấu hình được qua ENV; trần ENV không vượt trần cứng của VNPay', async () => {
        process.env.VNPAY_MIN_AMOUNT = '50000';
        process.env.VNPAY_MAX_AMOUNT = '20000000000';
        expect(provider.amountLimits()).toEqual({
          min: 50000,
          max: 9_999_999_999,
        });
        await expect(
          provider.createPayment({ ...createParams, amountVnd: 49999 }),
        ).rejects.toThrow(RangeError);
      });

      it('ENV số không hợp lệ/để trống rơi về mặc định', () => {
        process.env.VNPAY_MIN_AMOUNT = 'abc';
        process.env.VNPAY_MAX_AMOUNT = '';
        expect(provider.amountLimits()).toEqual({
          min: 1000,
          max: 9_999_999_999,
        });
      });

      it.each([
        ['returnUrl quá ngắn', { returnUrl: 'http://a' }],
        [
          'returnUrl quá dài (> 255)',
          { returnUrl: `https://a.com/${'x'.repeat(260)}` },
        ],
        ['txnRef có ký tự lạ', { txnRef: 'AB C-1' }],
        ['txnRef rỗng', { txnRef: '' }],
        ['txnRef quá dài (> 100)', { txnRef: 'A'.repeat(101) }],
      ])('%s', async (_l, override) => {
        await expect(
          provider.createPayment({ ...createParams, ...override }),
        ).rejects.toThrow(RangeError);
      });
    });
  });

  describe('verifyCallback', () => {
    it('chữ ký hợp lệ (vector cố định) — chuẩn hoá đúng kết quả, tiền đổi về VND', () => {
      expect(provider.verifyCallback(SUCCESS_CALLBACK)).toEqual({
        isSignatureValid: true,
        txnRef: 'ABC123',
        amountVnd: 10000,
        gatewayTransactionId: '14000001',
        outcome: 'SUCCESS',
      });
    });

    it('không phụ thuộc thứ tự tham số nhận được', () => {
      const shuffled = Object.fromEntries(
        Object.entries(SUCCESS_CALLBACK).reverse(),
      );
      expect(provider.verifyCallback(shuffled).isSignatureValid).toBe(true);
    });

    it('bỏ qua tham số không thuộc vnp_ (không nằm trong dữ liệu ký) và vnp_SecureHashType', () => {
      const result = provider.verifyCallback({
        ...SUCCESS_CALLBACK,
        utm_source: 'x',
        vnp_SecureHashType: 'HmacSHA512',
      });
      expect(result.isSignatureValid).toBe(true);
    });

    it('chữ ký viết HOA vẫn hợp lệ', () => {
      const result = provider.verifyCallback({
        ...SUCCESS_CALLBACK,
        vnp_SecureHash: SUCCESS_CALLBACK.vnp_SecureHash.toUpperCase(),
      });
      expect(result.isSignatureValid).toBe(true);
    });

    describe('bị từ chối (isSignatureValid=false, mọi field null/PENDING, KHÔNG ném lỗi)', () => {
      const rejected = {
        isSignatureValid: false,
        txnRef: null,
        amountVnd: null,
        gatewayTransactionId: null,
        outcome: 'PENDING',
      };

      it.each([
        ['sửa vnp_Amount', { vnp_Amount: '9999900' }],
        ['sửa vnp_TxnRef', { vnp_TxnRef: 'ZZZ999' }],
        [
          'sửa vnp_ResponseCode (biến thất bại thành thành công)',
          { vnp_ResponseCode: '24' },
        ],
        ['sửa vnp_TransactionStatus', { vnp_TransactionStatus: '02' }],
        ['thêm tham số vnp_ lạ', { vnp_Extra: '1' }],
        [
          'chữ ký sai 1 ký tự',
          {
            vnp_SecureHash: `${SUCCESS_CALLBACK.vnp_SecureHash.slice(0, -1)}0`,
          },
        ],
        ['chữ ký rỗng', { vnp_SecureHash: '' }],
        ['chữ ký ngắn bất thường', { vnp_SecureHash: 'abc' }],
        ['chữ ký dài bất thường', { vnp_SecureHash: 'a'.repeat(5000) }],
        ['chữ ký toàn ký tự đa byte', { vnp_SecureHash: 'é'.repeat(128) }],
      ])('%s', (_l, override) => {
        const result = provider.verifyCallback({
          ...SUCCESS_CALLBACK,
          ...override,
        });
        expect(result).toEqual(rejected);
      });

      it('thiếu vnp_SecureHash', () => {
        const { vnp_SecureHash: _omit, ...rest } = SUCCESS_CALLBACK;
        expect(provider.verifyCallback(rest)).toEqual(rejected);
      });

      it('thiếu 1 tham số đã ký (vnp_Amount)', () => {
        const { vnp_Amount: _omit, ...rest } = SUCCESS_CALLBACK;
        expect(provider.verifyCallback(rest)).toEqual(rejected);
      });

      it('body rỗng', () => {
        expect(provider.verifyCallback({})).toEqual(rejected);
      });

      it.each([
        ['mảng (query lặp key)', ['a', 'b']],
        ['object (a[x]=1)', { x: '1' }],
        ['số', 5],
        ['null', null],
        ['undefined', undefined],
      ])('giá trị vnp_ không phải chuỗi: %s', (_l, value) => {
        expect(
          provider.verifyCallback({ ...SUCCESS_CALLBACK, vnp_TxnRef: value }),
        ).toEqual(rejected);
      });

      it('chưa cấu hình cổng — không thể xác thực nên từ chối, không ném lỗi', () => {
        delete process.env.VNPAY_HASH_SECRET;
        expect(provider.verifyCallback(SUCCESS_CALLBACK)).toEqual(rejected);
      });

      it('chữ ký đúng nhưng ký bằng khoá KHÁC', () => {
        const forged = {
          ...SUCCESS_CALLBACK,
          vnp_SecureHash: signVnpay(
            buildSignData({
              ...SUCCESS_CALLBACK,
              vnp_SecureHash: undefined as never,
            }),
            'other-secret',
          ),
        };
        expect(provider.verifyCallback(forged)).toEqual(rejected);
      });
    });

    describe('kết quả thanh toán — thà chờ hơn là kết luận sai (Week7.md 1.10)', () => {
      const base = {
        vnp_Amount: '1000000',
        vnp_TmnCode: 'TESTCODE',
        vnp_TxnRef: 'ABC123',
        vnp_TransactionNo: '14000001',
      };
      const outcomeOf = (
        responseCode: string | undefined,
        status: string | undefined,
      ) => {
        const params: Record<string, string> = { ...base };
        if (responseCode !== undefined) params.vnp_ResponseCode = responseCode;
        if (status !== undefined) params.vnp_TransactionStatus = status;
        return provider.verifyCallback(signed(params)).outcome;
      };

      it('SUCCESS chỉ khi CẢ vnp_ResponseCode và vnp_TransactionStatus đều "00"', () => {
        expect(outcomeOf('00', '00')).toBe('SUCCESS');
        expect(outcomeOf('00', '01')).toBe('PENDING');
        expect(outcomeOf('00', '02')).toBe('PENDING');
        expect(outcomeOf('00', undefined)).toBe('PENDING');
        expect(outcomeOf(undefined, '00')).toBe('PENDING');
      });

      it.each(['09', '10', '11', '12', '13', '24', '51', '65', '75', '79'])(
        'mã thất bại xác định %s (kèm TransactionStatus 02) → FAILED',
        (code) => {
          expect(outcomeOf(code, '02')).toBe('FAILED');
        },
      );

      it('mã thất bại nhưng TransactionStatus "00" mâu thuẫn → PENDING, không kết luận', () => {
        expect(outcomeOf('24', '00')).toBe('PENDING');
      });

      it.each(['07', '99', '01', '99999', 'XX', ''])(
        'mã không xác định/mơ hồ %p → PENDING (không mở đường thanh toán lại)',
        (code) => {
          expect(outcomeOf(code, '02')).toBe('PENDING');
        },
      );

      it('TransactionStatus chưa hoàn tất (01) với mã thất bại vẫn chỉ FAILED khi khác 00', () => {
        expect(outcomeOf('24', '01')).toBe('FAILED');
      });
    });

    describe('số tiền', () => {
      const amountOf = (vnpAmount: string) =>
        provider.verifyCallback(
          signed({ vnp_TxnRef: 'A1', vnp_Amount: vnpAmount }),
        ).amountVnd;

      it.each([
        ['1000000', 10000],
        ['100', 1],
        ['999999999900', 9_999_999_999],
      ])('vnp_Amount %s → %i VND', (raw, expected) => {
        expect(amountOf(raw)).toBe(expected);
      });

      it.each(['1050', '99', '0.5', '-100', 'abc', '', '1000000000000', '1e6'])(
        'vnp_Amount %p không hợp lệ → null (người gọi coi là số tiền không khớp)',
        (raw) => {
          expect(amountOf(raw)).toBeNull();
        },
      );

      it('thiếu vnp_Amount (dù chữ ký đúng) → null', () => {
        expect(
          provider.verifyCallback(signed({ vnp_TxnRef: 'A1' })).amountVnd,
        ).toBeNull();
      });
    });
  });

  // Week9.md 2.4 — hoàn tiền tự động qua VNPay làm ở 2.12 (có hộp thời gian); tới lúc đó trả FAILED xác
  // định để Admin dùng đường "ghi nhận đã hoàn thủ công".
  describe('refund (tạm — Week9.md 2.12)', () => {
    const refundParams = {
      refundRef: 'refund-ref-0001',
      txnRef: 'ABC123',
      gatewayTransactionId: '14000001',
      amountVnd: 250000,
      paymentAmountVnd: 250000,
      reason: 'Order cancelled by buyer',
    };

    it('trả FAILED xác định kèm lý do hướng dẫn hoàn thủ công, không có mã hoàn', async () => {
      const result = await provider.refund();

      expect(result.outcome).toBe('FAILED');
      expect(result.gatewayRef).toBeNull();
      expect(result.failureReason).toContain('manually');
    });

    it('KHÔNG ném lỗi dù chưa cấu hình VNPay (không đọc khoá) — PaymentModule boot được khi thiếu ENV', async () => {
      for (const key of ENV_KEYS) delete process.env[key];

      await expect(provider.refund()).resolves.toMatchObject({
        outcome: 'FAILED',
      });
    });

    it('lý do không chứa khoá/chữ ký hay dữ liệu của giao dịch', async () => {
      process.env.VNPAY_TMN_CODE = 'TESTCODE';
      process.env.VNPAY_HASH_SECRET = SECRET;

      const result = await provider.refund();
      const text = JSON.stringify(result);

      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('TESTCODE');
      expect(text).not.toContain(refundParams.txnRef);
    });
  });
});
