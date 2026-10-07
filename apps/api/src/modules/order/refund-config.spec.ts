import { readRefundWindowDays } from './refund-config';

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
