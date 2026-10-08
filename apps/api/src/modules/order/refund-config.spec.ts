import {
  readRefundGatewayTimeoutMs,
  readRefundWindowDays,
  REFUND_PENDING_STALE_MS,
} from './refund-config';

describe('readRefundWindowDays', () => {
  afterEach(() => {
    delete process.env.REFUND_WINDOW_DAYS;
  });

  it('mặc định 7 ngày khi không cấu hình', () => {
    expect(readRefundWindowDays()).toBe(7);
  });

  it('lấy từ REFUND_WINDOW_DAYS', () => {
    process.env.REFUND_WINDOW_DAYS = '15';
    expect(readRefundWindowDays()).toBe(15);
  });

  it.each(['', '0', '-1', 'abc', '1.5'])(
    'giá trị %p — về mặc định 7, không ném lỗi',
    (value) => {
      process.env.REFUND_WINDOW_DAYS = value;
      expect(readRefundWindowDays()).toBe(7);
    },
  );
});

describe('readRefundGatewayTimeoutMs', () => {
  afterEach(() => {
    delete process.env.REFUND_GATEWAY_TIMEOUT_MS;
  });

  it('mặc định 8000ms khi không cấu hình', () => {
    expect(readRefundGatewayTimeoutMs()).toBe(8000);
  });

  it('lấy từ REFUND_GATEWAY_TIMEOUT_MS và đọc LÚC DÙNG (đổi giữa hai lần gọi có hiệu lực ngay)', () => {
    process.env.REFUND_GATEWAY_TIMEOUT_MS = '2500';
    expect(readRefundGatewayTimeoutMs()).toBe(2500);
    process.env.REFUND_GATEWAY_TIMEOUT_MS = '100';
    expect(readRefundGatewayTimeoutMs()).toBe(100);
  });

  it.each(['', '0', '-5', 'abc', '1.5'])(
    'giá trị %p — về mặc định 8000, không ném lỗi',
    (value) => {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = value;
      expect(readRefundGatewayTimeoutMs()).toBe(8000);
    },
  );
});

describe('REFUND_PENDING_STALE_MS', () => {
  it('là 5 phút (khớp Week9.md 1.5 — không phải ENV)', () => {
    expect(REFUND_PENDING_STALE_MS).toBe(5 * 60 * 1000);
  });
});
