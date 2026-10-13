import { MockPaymentProvider } from './mock-payment.provider';

const ENV_KEYS = [
  'NODE_ENV',
  'PAYMENT_MOCK_ENABLED',
  'PAYMENT_MOCK_SECRET',
  'PAYMENT_MOCK_REFUND_FAIL',
  'API_PUBLIC_URL',
];

describe('MockPaymentProvider', () => {
  const saved: Record<string, string | undefined> = {};
  let provider: MockPaymentProvider;
  const setEnv = (key: string, value: string) => {
    (process.env as Record<string, string | undefined>)[key] = value;
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    setEnv('NODE_ENV', 'test');
    setEnv('PAYMENT_MOCK_ENABLED', 'true');
    setEnv('PAYMENT_MOCK_SECRET', 'unit-test-secret');
    delete process.env.API_PUBLIC_URL;
    provider = new MockPaymentProvider();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else setEnv(key, saved[key]);
    }
  });

  const params = {
    txnRef: 'MOCKREF00000000000001',
    amountVnd: 150000,
    returnUrl: 'http://x.test/return',
    expiresAt: new Date('2026-09-27T03:45:00Z'),
    locale: 'vi' as const,
  };

  const refundParams = {
    refundRef: 'refund-ref-0001',
    txnRef: params.txnRef,
    gatewayTransactionId: 'MOCKTXN000001',
    gatewayPaidAt: null,
    amountVnd: 150000,
    paymentAmountVnd: 150000,
    reason: 'Order cancelled by buyer',
  };

  describe('refund (Week9.md 1.6)', () => {
    it('thành công tức thì, mã hoàn xác định theo refundRef', async () => {
      const result = await provider.refund(refundParams);

      expect(result).toEqual({
        outcome: 'SUCCESS',
        gatewayRef: 'MOCK-REFUND-refund-ref-0001',
        failureReason: null,
      });
    });

    it('gọi lại với CÙNG refundRef ra CÙNG mã hoàn (idempotent); refundRef khác ra mã khác', async () => {
      const first = await provider.refund(refundParams);
      const again = await provider.refund(refundParams);
      const other = await provider.refund({
        ...refundParams,
        refundRef: 'refund-ref-0002',
      });

      expect(again.gatewayRef).toBe(first.gatewayRef);
      expect(other.gatewayRef).not.toBe(first.gatewayRef);
    });

    it('hoàn một phần (nhóm nhiều đơn hủy 1 đơn) vẫn thành công', async () => {
      const result = await provider.refund({
        ...refundParams,
        amountVnd: 40000,
        paymentAmountVnd: 150000,
      });

      expect(result.outcome).toBe('SUCCESS');
    });

    it.each([0, -1, 1.5, 150001, Number.NaN])(
      'số tiền hoàn %p không hợp lệ (không nguyên/không dương/vượt số đã thanh toán) ⇒ FAILED kèm lý do, không có mã hoàn',
      async (amountVnd) => {
        const result = await provider.refund({ ...refundParams, amountVnd });

        expect(result.outcome).toBe('FAILED');
        expect(result.gatewayRef).toBeNull();
        expect(result.failureReason).toContain('out of range');
      },
    );

    it.each(['true', 'TRUE', ' True '])(
      'PAYMENT_MOCK_REFUND_FAIL=%p ép mọi lần hoàn thất bại (để test tay đường lỗi)',
      async (value) => {
        setEnv('PAYMENT_MOCK_REFUND_FAIL', value);

        const result = await provider.refund(refundParams);

        expect(result).toEqual({
          outcome: 'FAILED',
          gatewayRef: null,
          failureReason: expect.stringContaining(
            'PAYMENT_MOCK_REFUND_FAIL',
          ) as unknown,
        });
      },
    );

    it.each([undefined, '', 'false', '0', 'yes'])(
      'PAYMENT_MOCK_REFUND_FAIL=%p KHÔNG ép thất bại (chỉ "true" mới ép)',
      async (value) => {
        if (value === undefined) delete process.env.PAYMENT_MOCK_REFUND_FAIL;
        else setEnv('PAYMENT_MOCK_REFUND_FAIL', value);

        expect((await provider.refund(refundParams)).outcome).toBe('SUCCESS');
      },
    );

    it('đọc cờ LÚC DÙNG, không lúc khởi tạo provider: đổi ENV giữa 2 lần gọi có hiệu lực ngay', async () => {
      expect((await provider.refund(refundParams)).outcome).toBe('SUCCESS');

      setEnv('PAYMENT_MOCK_REFUND_FAIL', 'true');
      expect((await provider.refund(refundParams)).outcome).toBe('FAILED');

      delete process.env.PAYMENT_MOCK_REFUND_FAIL;
      expect((await provider.refund(refundParams)).outcome).toBe('SUCCESS');
    });

    it('số tiền sai ưu tiên hơn cờ ép thất bại (lý do thật là số tiền, không bị che bởi cờ test)', async () => {
      setEnv('PAYMENT_MOCK_REFUND_FAIL', 'true');

      const result = await provider.refund({ ...refundParams, amountVnd: 0 });

      expect(result.failureReason).toContain('out of range');
    });

    it('mock chưa bật (PAYMENT_MOCK_ENABLED không phải "true") ⇒ từ chối, không âm thầm hoàn', async () => {
      delete process.env.PAYMENT_MOCK_ENABLED;

      await expect(provider.refund(refundParams)).rejects.toThrow(
        'Mock payment is disabled',
      );
    });
  });

  describe('bị vô hiệu hoá CỨNG ở production (3 lớp), dù cờ ENV bật', () => {
    beforeEach(() => setEnv('NODE_ENV', 'production'));

    it('isConfigured = false', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    it('createPayment bị từ chối', async () => {
      await expect(provider.createPayment(params)).rejects.toThrow(
        'Mock payment is disabled',
      );
    });

    it('refund cũng bị từ chối, dù ép thất bại hay không (không bao giờ "hoàn" ở production)', async () => {
      await expect(provider.refund(refundParams)).rejects.toThrow(
        'Mock payment is disabled',
      );

      setEnv('PAYMENT_MOCK_REFUND_FAIL', 'true');
      await expect(provider.refund(refundParams)).rejects.toThrow(
        'Mock payment is disabled',
      );
    });

    it('verifyCallback từ chối cả callback có chữ ký ĐÚNG; verifyPayLink cũng false', async () => {
      // Dựng callback và link hợp lệ khi chưa phải production, rồi kiểm ở production.
      setEnv('NODE_ENV', 'test');
      const raw = provider.buildCallback(params.txnRef, 150000, 'SUCCESS');
      const { payUrl } = await provider.createPayment(params);
      const sig = new URL(payUrl).searchParams.get('sig') ?? '';
      expect(provider.verifyPayLink(params.txnRef, '150000', sig)).toBe(true);
      setEnv('NODE_ENV', 'production');

      expect(provider.verifyCallback(raw).isSignatureValid).toBe(false);
      expect(provider.verifyPayLink(params.txnRef, '150000', sig)).toBe(false);
    });
  });

  describe('cờ ENV', () => {
    it.each([undefined, '', 'false', '0', 'yes', '1'])(
      'PAYMENT_MOCK_ENABLED=%p → tắt (chỉ "true" mới bật)',
      (value) => {
        if (value === undefined) delete process.env.PAYMENT_MOCK_ENABLED;
        else setEnv('PAYMENT_MOCK_ENABLED', value);
        expect(provider.isConfigured()).toBe(false);
      },
    );

    it.each(['true', 'TRUE', ' true '])(
      'PAYMENT_MOCK_ENABLED=%p → bật',
      (value) => {
        setEnv('PAYMENT_MOCK_ENABLED', value);
        expect(provider.isConfigured()).toBe(true);
      },
    );

    it('khởi tạo không throw dù thiếu mọi ENV', () => {
      for (const key of ENV_KEYS) delete process.env[key];
      expect(() => new MockPaymentProvider()).not.toThrow();
    });
  });

  describe('createPayment', () => {
    it('payUrl trỏ tới endpoint mock của BE, kèm txnRef, amount và chữ ký', async () => {
      setEnv('API_PUBLIC_URL', 'https://api.example.com/');

      const { payUrl } = await provider.createPayment(params);
      const url = new URL(payUrl);

      expect(url.origin + url.pathname).toBe(
        'https://api.example.com/api/v1/payments/mock/pay',
      );
      expect(url.searchParams.get('txnRef')).toBe(params.txnRef);
      expect(url.searchParams.get('amount')).toBe('150000');
      expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('API_PUBLIC_URL để trống rơi về localhost (`?.trim() || fallback`)', async () => {
      setEnv('API_PUBLIC_URL', '');
      const { payUrl } = await provider.createPayment(params);
      expect(
        payUrl.startsWith('http://localhost:4000/api/v1/payments/mock/pay?'),
      ).toBe(true);
    });

    it('link do createPayment phát ra thì verifyPayLink chấp nhận; sửa amount/txnRef thì từ chối', async () => {
      const { payUrl } = await provider.createPayment(params);
      const q = new URL(payUrl).searchParams;
      const sig = q.get('sig') ?? '';

      expect(provider.verifyPayLink(params.txnRef, '150000', sig)).toBe(true);
      expect(provider.verifyPayLink(params.txnRef, '1', sig)).toBe(false);
      expect(provider.verifyPayLink('OTHER', '150000', sig)).toBe(false);
      expect(provider.verifyPayLink(params.txnRef, '150000', 'abc')).toBe(
        false,
      );
    });
  });

  describe('callback đi đúng đường xác nhận thật (verifyCallback)', () => {
    it.each(['SUCCESS', 'FAILED', 'PENDING'] as const)(
      '%s hợp lệ',
      (outcome) => {
        const raw = provider.buildCallback(params.txnRef, 150000, outcome);

        expect(provider.verifyCallback(raw)).toEqual({
          isSignatureValid: true,
          txnRef: params.txnRef,
          amountVnd: 150000,
          gatewayTransactionId: `MOCK${params.txnRef.slice(0, 12)}`,
          outcome,
        });
      },
    );

    const rejected = {
      isSignatureValid: false,
      txnRef: null,
      amountVnd: null,
      gatewayTransactionId: null,
      outcome: 'PENDING',
    };

    it.each([
      ['sửa amount', { amount: '1' }],
      ['sửa outcome (FAILED → SUCCESS)', { outcome: 'SUCCESS' }],
      ['sửa txnRef', { txnRef: 'OTHER' }],
      ['sửa transactionNo', { transactionNo: 'X' }],
      ['chữ ký rỗng', { sig: '' }],
      ['chữ ký ngắn', { sig: 'abc' }],
      ['chữ ký rất dài', { sig: 'a'.repeat(10_000) }],
      ['outcome lạ', { outcome: 'REFUNDED' }],
      ['amount không phải chuỗi', { amount: 150000 }],
    ])('%s bị từ chối, không ném lỗi', (_l, override) => {
      const raw = provider.buildCallback(params.txnRef, 150000, 'FAILED');

      expect(provider.verifyCallback({ ...raw, ...override })).toEqual(
        rejected,
      );
    });

    it('thiếu field / body rỗng', () => {
      const { sig: _omit, ...withoutSig } = provider.buildCallback(
        params.txnRef,
        1000,
        'SUCCESS',
      );
      expect(provider.verifyCallback(withoutSig)).toEqual(rejected);
      expect(provider.verifyCallback({})).toEqual(rejected);
    });

    it('chữ ký của môi trường khác (khác PAYMENT_MOCK_SECRET) bị từ chối', () => {
      const raw = provider.buildCallback(params.txnRef, 150000, 'SUCCESS');
      setEnv('PAYMENT_MOCK_SECRET', 'another-secret');

      expect(provider.verifyCallback(raw)).toEqual(rejected);
    });

    it('amount không phải số nguyên hợp lệ dù chữ ký đúng → amountVnd null', () => {
      const raw = provider.buildCallback(params.txnRef, Number.NaN, 'SUCCESS');
      expect(provider.verifyCallback(raw).amountVnd).toBeNull();
    });
  });
});
