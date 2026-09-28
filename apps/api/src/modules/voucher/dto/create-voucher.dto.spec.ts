import { createVoucherSchema } from './create-voucher.dto';

const base = { code: 'SALE10', type: 'PERCENT' as const, value: 10 };

describe('createVoucherSchema', () => {
  it('payload tối thiểu hợp lệ', () => {
    expect(createVoucherSchema.safeParse(base).success).toBe(true);
  });

  it('PERCENT lớn hơn 100 bị từ chối', () => {
    expect(createVoucherSchema.safeParse({ ...base, value: 101 }).success).toBe(
      false,
    );
  });

  it('PERCENT đúng 100 hợp lệ', () => {
    expect(createVoucherSchema.safeParse({ ...base, value: 100 }).success).toBe(
      true,
    );
  });

  it('FIXED phải là số nguyên đồng', () => {
    const fixed = { code: 'OFF50', type: 'FIXED' as const };

    expect(
      createVoucherSchema.safeParse({ ...fixed, value: 50000.5 }).success,
    ).toBe(false);
    expect(
      createVoucherSchema.safeParse({ ...fixed, value: 50000 }).success,
    ).toBe(true);
  });

  it('maxDiscountAmount chỉ hợp lệ với PERCENT', () => {
    expect(
      createVoucherSchema.safeParse({
        code: 'OFF50',
        type: 'FIXED',
        value: 50000,
        maxDiscountAmount: 10000,
      }).success,
    ).toBe(false);
    expect(
      createVoucherSchema.safeParse({ ...base, maxDiscountAmount: 30000 })
        .success,
    ).toBe(true);
  });

  it.each([
    ['quá ngắn', 'ab'],
    ['có khoảng trắng', 'SALE 10'],
    ['có ký tự đặc biệt', 'SALE%10'],
    ['quá dài', 'A'.repeat(33)],
  ])('mã %s bị từ chối', (_label, code) => {
    expect(createVoucherSchema.safeParse({ ...base, code }).success).toBe(
      false,
    );
  });

  it('nhận mã chữ thường (BE tự chuẩn hoá thành chữ hoa)', () => {
    expect(
      createVoucherSchema.safeParse({ ...base, code: 'summer-10' }).success,
    ).toBe(true);
  });

  it('value phải lớn hơn 0, usageLimit/perUserLimit ≥ 1 và là số nguyên', () => {
    expect(createVoucherSchema.safeParse({ ...base, value: 0 }).success).toBe(
      false,
    );
    expect(
      createVoucherSchema.safeParse({ ...base, usageLimit: 0 }).success,
    ).toBe(false);
    expect(
      createVoucherSchema.safeParse({ ...base, perUserLimit: 1.5 }).success,
    ).toBe(false);
  });

  it('expiresAt phải là ISO datetime', () => {
    expect(
      createVoucherSchema.safeParse({ ...base, expiresAt: 'ngày mai' }).success,
    ).toBe(false);
    expect(
      createVoucherSchema.safeParse({
        ...base,
        expiresAt: '2030-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
