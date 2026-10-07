import { readOrderAutoCompleteDays } from './order-config';

describe('readOrderAutoCompleteDays', () => {
  afterEach(() => {
    delete process.env.ORDER_AUTO_COMPLETE_DAYS;
  });

  it('mặc định 7 ngày khi không cấu hình', () => {
    expect(readOrderAutoCompleteDays()).toBe(7);
  });

  it('lấy từ ORDER_AUTO_COMPLETE_DAYS', () => {
    process.env.ORDER_AUTO_COMPLETE_DAYS = '10';
    expect(readOrderAutoCompleteDays()).toBe(10);
  });

  it.each(['', '0', '-1', 'abc', '1.5'])(
    'giá trị %p — về mặc định 7, không ném lỗi',
    (value) => {
      process.env.ORDER_AUTO_COMPLETE_DAYS = value;
      expect(readOrderAutoCompleteDays()).toBe(7);
    },
  );
});
