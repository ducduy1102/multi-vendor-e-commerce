import { createHmac } from 'crypto';
import { VNPAY_SANDBOX_REFUND_URL } from './payment-config';
import { MANUAL_REFUND_HINT } from './vnpay-refund';
import {
  buildPipeSignData,
  buildSignData,
  signVnpay,
  VNPAY_REFUND_RESPONSE_SIGN_FIELDS,
} from './vnpay-signature';
import { VnpayProvider } from './vnpay.provider';

const SECRET = 'SECRETKEY123456789';
const ENV_KEYS = [
  'VNPAY_TMN_CODE',
  'VNPAY_HASH_SECRET',
  'VNPAY_PAY_URL',
  'VNPAY_REFUND_URL',
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
        gatewayPaidAt: null,
        outcome: 'SUCCESS',
      });
    });

    // Week9.md 2.12 — VNPay đòi lại vnp_PayDate làm vnp_TransactionDate khi hoàn tiền.
    describe('gatewayPaidAt (vnp_PayDate, GMT+7)', () => {
      const payDateCallback = (payDate?: string) =>
        provider.verifyCallback(
          signed({
            vnp_Amount: '1000000',
            vnp_ResponseCode: '00',
            vnp_TransactionNo: '14000001',
            vnp_TransactionStatus: '00',
            vnp_TxnRef: 'ABC123',
            ...(payDate === undefined ? {} : { vnp_PayDate: payDate }),
          }),
        );

      it('đọc vnp_PayDate (GMT+7) thành mốc UTC', () => {
        expect(payDateCallback('20260927103025').gatewayPaidAt).toEqual(
          new Date('2026-09-27T03:30:25Z'),
        );
      });

      it.each([
        ['thiếu vnp_PayDate', undefined],
        ['sai định dạng', '2026-09-27'],
        ['ngày không có thật', '20260231120000'],
        ['giờ không có thật', '20260927250000'],
      ])('%s ⇒ null (callback vẫn hợp lệ)', (_label, payDate) => {
        const result = payDateCallback(payDate);

        expect(result.isSignatureValid).toBe(true);
        expect(result.gatewayPaidAt).toBeNull();
      });

      it('chữ ký sai ⇒ không đọc vnp_PayDate (null)', () => {
        const result = provider.verifyCallback({
          ...SUCCESS_CALLBACK,
          vnp_PayDate: '20260927103025',
        });

        expect(result.isSignatureValid).toBe(false);
        expect(result.gatewayPaidAt).toBeNull();
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
        gatewayPaidAt: null,
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

  // Week9.md 2.12 — hoàn tiền qua API `vnp_Command=refund`. Cuộc gọi mạng được thay bằng fetch giả; logic dựng
  // request / kiểm chữ ký / phân loại mã đã có vector cố định ở vnpay-refund.spec.ts, ở đây kiểm phần GHÉP:
  // điều kiện gọi, URL, hạn chờ, lỗi mạng/HTTP/body và việc không lộ khoá.
  describe('refund (Week9.md 2.12)', () => {
    const refundParams = {
      refundRef: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      txnRef: 'ABC123',
      gatewayTransactionId: '14000001',
      gatewayPaidAt: new Date('2026-09-27T03:30:25Z'),
      amountVnd: 100_000,
      paymentAmountVnd: 250_000,
      reason: 'Order cancelled by buyer',
    };

    let fetchMock: jest.SpyInstance;

    // Phản hồi ký bằng SECRET của spec (đúng thứ tự trường của tài liệu); trường vắng nối thành chuỗi rỗng.
    function signedResponse(fields: Record<string, string>) {
      return {
        ...fields,
        vnp_SecureHash: createHmac('sha512', SECRET)
          .update(
            buildPipeSignData(VNPAY_REFUND_RESPONSE_SIGN_FIELDS, fields),
            'utf8',
          )
          .digest('hex'),
      };
    }

    const acceptedResponse = () =>
      signedResponse({
        vnp_ResponseId: 'resp0001',
        vnp_Command: 'refund',
        vnp_ResponseCode: '00',
        vnp_Message: 'Refund success',
        vnp_TmnCode: 'TESTCODE',
        vnp_TxnRef: 'ABC123',
        vnp_Amount: '10000000',
        vnp_BankCode: 'NCB',
        vnp_PayDate: '20260927110005',
        vnp_TransactionNo: '14000099',
        vnp_TransactionType: '03',
        vnp_TransactionStatus: '05',
        vnp_OrderInfo: 'Hoan tien don hang ABC123',
      });

    function answerWith(
      body: unknown,
      init: { ok?: boolean; status?: number } = {},
    ) {
      fetchMock.mockResolvedValue({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: () => Promise.resolve(body),
      });
    }

    function sentBody(): Record<string, string> {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return JSON.parse(init.body as string) as Record<string, string>;
    }

    function calledUrl(): string {
      return (fetchMock.mock.calls[0] as [string])[0];
    }

    beforeEach(() => {
      fetchMock = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    describe('KHÔNG gọi cổng — FAILED xác định kèm hướng dẫn hoàn thủ công', () => {
      it('chưa cấu hình VNPay: không ném lỗi (PaymentModule boot được khi thiếu ENV), không gọi mạng', async () => {
        for (const key of ENV_KEYS) delete process.env[key];

        const result = await provider.refund(refundParams);

        expect(result).toEqual({
          outcome: 'FAILED',
          gatewayRef: null,
          failureReason: `VNPay is not configured; ${MANUAL_REFUND_HINT}`,
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('thanh toán cũ chưa có mốc cổng ghi nhận (gatewayPaidAt null): hoàn thủ công, không đoán mốc', async () => {
        const result = await provider.refund({
          ...refundParams,
          gatewayPaidAt: null,
        });

        expect(result.outcome).toBe('FAILED');
        expect(result.failureReason).toContain(MANUAL_REFUND_HINT);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('thiếu mã giao dịch của cổng, số tiền hoàn quá số đã thanh toán: không gọi mạng', async () => {
        for (const override of [
          { gatewayTransactionId: null },
          { amountVnd: 250_001 },
        ]) {
          const result = await provider.refund({
            ...refundParams,
            ...override,
          });

          expect(result.outcome).toBe('FAILED');
        }
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe('gọi API hoàn tiền', () => {
      it('POST JSON tới URL sandbox mặc định; body đúng trường, đúng chữ ký (tính độc lập), có hạn chờ', async () => {
        answerWith(acceptedResponse());

        const result = await provider.refund(refundParams);

        expect(result).toEqual({
          outcome: 'SUCCESS',
          gatewayRef: '14000099',
          failureReason: null,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(VNPAY_SANDBOX_REFUND_URL);
        expect(url).toBe(
          'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
        );
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(init.signal).toBeInstanceOf(AbortSignal);

        const body = sentBody();
        expect(body).toMatchObject({
          vnp_RequestId: refundParams.refundRef,
          vnp_Version: '2.1.0',
          vnp_Command: 'refund',
          vnp_TmnCode: 'TESTCODE',
          vnp_TransactionType: '03',
          vnp_TxnRef: 'ABC123',
          vnp_Amount: '10000000',
          vnp_TransactionNo: '14000001',
          vnp_TransactionDate: '20260927103025',
          vnp_CreateBy: 'system',
          vnp_IpAddr: '127.0.0.1',
          vnp_OrderInfo: 'Hoan tien don hang ABC123',
        });
        expect(body.vnp_CreateDate).toMatch(/^\d{14}$/);
        const expectedHash = createHmac('sha512', SECRET)
          .update(
            [
              body.vnp_RequestId,
              body.vnp_Version,
              body.vnp_Command,
              body.vnp_TmnCode,
              body.vnp_TransactionType,
              body.vnp_TxnRef,
              body.vnp_Amount,
              body.vnp_TransactionNo,
              body.vnp_TransactionDate,
              body.vnp_CreateBy,
              body.vnp_CreateDate,
              body.vnp_IpAddr,
              body.vnp_OrderInfo,
            ].join('|'),
            'utf8',
          )
          .digest('hex');
        expect(body.vnp_SecureHash).toBe(expectedHash);
      });

      it('hoàn đủ số đã thanh toán ⇒ loại 02', async () => {
        answerWith(acceptedResponse());

        await provider.refund({ ...refundParams, amountVnd: 250_000 });

        expect(sentBody().vnp_TransactionType).toBe('02');
      });

      it('VNPAY_REFUND_URL tuỳ chỉnh được dùng (production), để trống thì về sandbox', async () => {
        answerWith(acceptedResponse());
        process.env.VNPAY_REFUND_URL =
          'https://pay.example.vn/merchant_webapi/api/transaction';

        await provider.refund(refundParams);
        expect(calledUrl()).toBe(
          'https://pay.example.vn/merchant_webapi/api/transaction',
        );

        fetchMock.mockClear();
        process.env.VNPAY_REFUND_URL = '   ';
        await provider.refund(refundParams);
        expect(calledUrl()).toBe(VNPAY_SANDBOX_REFUND_URL);
      });

      it('VNPAY_REFUND_URL sai ⇒ reject (PENDING ở RefundService), không gọi mạng', async () => {
        process.env.VNPAY_REFUND_URL = 'not a url';

        await expect(provider.refund(refundParams)).rejects.toThrow(
          'VNPAY_REFUND_URL',
        );
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe('kết quả nghiệp vụ của cổng (không ném lỗi)', () => {
      it('không thấy giao dịch gốc (91, có chữ ký) ⇒ FAILED kèm lời nhắn của cổng', async () => {
        answerWith(
          signedResponse({
            vnp_ResponseId: 'resp0003',
            vnp_Command: 'refund',
            vnp_ResponseCode: '91',
            vnp_Message: 'Transaction not found',
            vnp_TmnCode: 'TESTCODE',
            vnp_TxnRef: 'ABC123',
            vnp_Amount: '10000000',
          }),
        );

        await expect(provider.refund(refundParams)).resolves.toEqual({
          outcome: 'FAILED',
          gatewayRef: null,
          failureReason:
            'VNPay rejected the refund (code 91): Transaction not found',
        });
      });

      it('trùng mã yêu cầu (94, không chữ ký) ⇒ PENDING: yêu cầu trước của ta có thể đã được nhận', async () => {
        answerWith({
          vnp_ResponseCode: '94',
          vnp_Message: 'Request is duplicated',
        });

        await expect(provider.refund(refundParams)).resolves.toEqual({
          outcome: 'PENDING',
          gatewayRef: null,
          failureReason: null,
        });
      });
    });

    describe('lỗi bất ngờ ⇒ reject (RefundService coi là PENDING, thử lại bằng cùng refundRef)', () => {
      it('lỗi mạng', async () => {
        fetchMock.mockRejectedValue(new Error('socket hang up'));

        await expect(provider.refund(refundParams)).rejects.toThrow(
          'socket hang up',
        );
      });

      it('HTTP không phải 2xx — message chỉ nêu trạng thái, không kèm body/URL/chữ ký', async () => {
        answerWith({ any: 'thing' }, { ok: false, status: 502 });

        const error = await provider
          .refund(refundParams)
          .catch((e: Error) => e);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          'VNPay refund API answered HTTP 502',
        );
      });

      it('body không phải JSON', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        });

        await expect(provider.refund(refundParams)).rejects.toThrow('not JSON');
      });

      it('body không phải phản hồi hoàn tiền (thiếu vnp_ResponseCode)', async () => {
        answerWith({ hello: 'world' });

        await expect(provider.refund(refundParams)).rejects.toThrow(
          'could not be understood',
        );
      });

      it('chữ ký phản hồi sai — kể cả khi nói "thành công" thì không tin', async () => {
        answerWith({ ...acceptedResponse(), vnp_Amount: '99999999' });

        await expect(provider.refund(refundParams)).rejects.toThrow(
          'invalid signature',
        );
      });

      it('"thành công" mà không có chữ ký — không tin', async () => {
        const { vnp_SecureHash: _hash, ...unsigned } = acceptedResponse();
        void _hash;
        answerWith(unsigned);

        await expect(provider.refund(refundParams)).rejects.toThrow(
          'not signed',
        );
      });
    });

    it('không lộ khoá: không trong body gửi đi, không trong kết quả, không trong message lỗi', async () => {
      answerWith(acceptedResponse());
      await provider.refund(refundParams);
      expect(JSON.stringify(sentBody())).not.toContain(SECRET);

      answerWith({ ...acceptedResponse(), vnp_Amount: '1' });
      const error = await provider.refund(refundParams).catch((e: Error) => e);
      expect((error as Error).message).not.toContain(SECRET);

      answerWith(acceptedResponse());
      const result = await provider.refund(refundParams);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });
  });
});
