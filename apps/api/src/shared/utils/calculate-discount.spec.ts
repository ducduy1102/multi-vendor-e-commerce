import { VoucherType } from '@prisma/client';
import { calculateDiscount } from './calculate-discount';

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

// Week7.md 1.6: bản cũ tính `Math.floor((base * value) / 100)` bằng số thực nên phần trăm thập phân
// bị lệch 1 đồng (thấp hơn). Số học nguyên phải cho đúng kết quả toán học.
describe('calculateDiscount — số học nguyên với phần trăm thập phân', () => {
  it.each([
    [50000, 0.29, 145],
    [150000, 0.41, 615],
    [100000, 0.29, 290],
    [100001, 12.5, 12500],
    [99990, 15, 14998],
  ])(
    '%i × %f%% → %i (không lệch 1 đồng do dấu phẩy động)',
    (base, value, expected) => {
      expect(calculateDiscount(percent(value), base)).toBe(expected);
    },
  );

  it('phần trăm rất nhỏ nhân cơ sở nhỏ ra 0, không âm', () => {
    expect(calculateDiscount(percent(0.01), 99)).toBe(0);
  });

  it('số lớn (10^10 đồng, giới hạn Decimal(12,2)) không tràn số nguyên an toàn', () => {
    // 99,99% × 10^10 = 9.999.000.000; số thực dễ mất độ chính xác ở tích trung gian.
    expect(calculateDiscount(percent(99.99), 10 ** 10)).toBe(9_999_000_000);
    expect(calculateDiscount(percent(33.33), 9_999_999_999)).toBe(
      3_332_999_999,
    );
  });

  // Tham chiếu ĐỘC LẬP: dựng số nguyên từ chuỗi "x.yz" (không dùng phép nhân số thực).
  function reference(base: number, value: number): number {
    const [whole, frac = ''] = value.toFixed(2).split('.');
    const hundredths = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
    return Number((BigInt(base) * hundredths) / 10000n);
  }

  const BASES = [
    1,
    7,
    99,
    999,
    12345,
    50000,
    99990,
    100000,
    150000,
    250000,
    999999,
    5_000_000,
    123_456_789,
    10 ** 10,
  ];

  it('khớp tham chiếu với MỌI phần trăm 0,01% → 100,00% trên nhiều mức cơ sở', () => {
    const mismatches: string[] = [];
    for (let hundredths = 1; hundredths <= 10000; hundredths++) {
      const value = hundredths / 100;
      for (const base of BASES) {
        const actual = calculateDiscount(percent(value), base);
        const expected = Math.min(reference(base, value), base);
        if (actual !== expected)
          mismatches.push(`${base} × ${value}% → ${actual}, đúng ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('phần trăm NGUYÊN cho đúng kết quả của công thức cũ (không đổi hành vi phổ biến)', () => {
    for (let value = 1; value <= 100; value++) {
      for (const base of BASES) {
        expect(calculateDiscount(percent(value), base)).toBe(
          Math.min(Math.floor((base * value) / 100), base),
        );
      }
    }
  });

  it('kết quả không bao giờ vượt cơ sở và không âm', () => {
    for (const value of [0.01, 12.5, 33.33, 99.99, 100]) {
      for (const base of BASES) {
        const amount = calculateDiscount(percent(value), base);
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(base);
      }
    }
  });
});
