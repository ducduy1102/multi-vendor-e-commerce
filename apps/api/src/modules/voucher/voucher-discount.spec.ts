import { VoucherType } from '@prisma/client';
import { calculateDiscount } from './voucher-discount';

const percent = (value: number, maxDiscountAmount: number | null = null) => ({
  type: VoucherType.PERCENT,
  value,
  maxDiscountAmount,
});
const fixed = (value: number) => ({
  type: VoucherType.FIXED,
  value,
  maxDiscountAmount: null,
});

describe('calculateDiscount', () => {
  it('PERCENT — tính đúng phần trăm trên cơ sở', () => {
    expect(calculateDiscount(percent(10), 500000)).toBe(50000);
  });

  it('PERCENT — kết quả lẻ làm tròn XUỐNG tới đồng', () => {
    // 15% của 99.990đ = 14.998,5đ → 14.998đ
    expect(calculateDiscount(percent(15), 99990)).toBe(14998);
  });

  it('PERCENT — giá trị phần trăm có phần lẻ (12,5%) vẫn làm tròn xuống', () => {
    // 12,5% của 100.001đ = 12.500,125đ → 12.500đ
    expect(calculateDiscount(percent(12.5), 100001)).toBe(12500);
  });

  it('PERCENT — cap cũng làm tròn xuống khi maxDiscountAmount có phần lẻ', () => {
    expect(calculateDiscount(percent(50, 30000.9), 500000)).toBe(30000);
  });

  it('PERCENT — chạm maxDiscountAmount thì bị cap', () => {
    expect(calculateDiscount(percent(50, 30000), 500000)).toBe(30000);
  });

  it('PERCENT — chưa chạm maxDiscountAmount thì giữ nguyên số tính được', () => {
    expect(calculateDiscount(percent(10, 100000), 500000)).toBe(50000);
  });

  it('FIXED — không bị cap bởi maxDiscountAmount', () => {
    expect(
      calculateDiscount(
        { type: VoucherType.FIXED, value: 80000, maxDiscountAmount: 10000 },
        500000,
      ),
    ).toBe(80000);
  });

  it('FIXED — lớn hơn cơ sở thì chỉ giảm tối đa bằng cơ sở', () => {
    expect(calculateDiscount(fixed(200000), 150000)).toBe(150000);
  });

  it('PERCENT 100% không vượt cơ sở', () => {
    expect(calculateDiscount(percent(100), 120000)).toBe(120000);
  });

  it('cơ sở bằng 0 hoặc âm — không giảm', () => {
    expect(calculateDiscount(percent(10), 0)).toBe(0);
    expect(calculateDiscount(fixed(50000), -1)).toBe(0);
  });
});
