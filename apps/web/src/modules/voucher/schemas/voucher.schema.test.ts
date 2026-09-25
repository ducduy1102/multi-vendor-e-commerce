import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_VOUCHER_FORM_VALUES,
  toCreateVoucherInput,
  voucherFormSchema,
  type VoucherFormValues,
} from './voucher.schema';

function values(overrides: Partial<VoucherFormValues> = {}): VoucherFormValues {
  return { ...EMPTY_VOUCHER_FORM_VALUES, code: 'SALE10', value: '10', ...overrides };
}

function messagesByField(input: VoucherFormValues): Record<string, string> {
  const result = voucherFormSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe('toCreateVoucherInput', () => {
  it('chuyển chuỗi form sang số, bỏ các ô để trống', () => {
    expect(toCreateVoucherInput(values({ code: '  sale10 ' }))).toEqual({
      code: 'sale10',
      type: 'PERCENT',
      value: 10,
      minOrderAmount: undefined,
      maxDiscountAmount: undefined,
      usageLimit: undefined,
      perUserLimit: undefined,
      expiresAt: undefined,
    });
  });

  it('đủ mọi ô -> số đúng và expiresAt thành ISO', () => {
    const result = toCreateVoucherInput(
      values({
        minOrderAmount: '200000',
        maxDiscountAmount: '50000',
        usageLimit: '100',
        perUserLimit: '1',
        expiresAt: '2030-01-01T10:30',
      }),
    );

    expect(result).toMatchObject({
      minOrderAmount: 200000,
      maxDiscountAmount: 50000,
      usageLimit: 100,
      perUserLimit: 1,
    });
    expect(result.expiresAt).toBe(new Date('2030-01-01T10:30').toISOString());
  });

  it('loại FIXED -> bỏ maxDiscountAmount dù người dùng đã nhập trước khi đổi loại', () => {
    const result = toCreateVoucherInput(
      values({ type: 'FIXED', value: '50000', maxDiscountAmount: '10000' }),
    );

    expect(result.maxDiscountAmount).toBeUndefined();
  });
});

describe('voucherFormSchema', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('form tối thiểu (mã + giá trị) hợp lệ', () => {
    expect(voucherFormSchema.safeParse(values()).success).toBe(true);
  });

  it('form đủ mọi ô hợp lệ', () => {
    expect(
      voucherFormSchema.safeParse(
        values({
          minOrderAmount: '200000',
          maxDiscountAmount: '50000',
          usageLimit: '100',
          perUserLimit: '1',
          expiresAt: '2030-01-01T10:30',
        }),
      ).success,
    ).toBe(true);
  });

  describe('mã voucher', () => {
    it.each([
      ['rỗng', ''],
      ['quá ngắn', 'ab'],
      ['có khoảng trắng', 'SALE 10'],
      ['có ký tự đặc biệt', 'SALE%10'],
      ['quá dài', 'A'.repeat(33)],
    ])('%s -> báo lỗi ở ô mã', (_label, code) => {
      expect(messagesByField(values({ code })).code).toBe(
        'Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, dài 3-32 ký tự',
      );
    });

    it('nhận chữ thường (BE tự chuẩn hoá chữ hoa)', () => {
      expect(voucherFormSchema.safeParse(values({ code: 'summer-10' })).success).toBe(true);
    });
  });

  describe('giá trị giảm', () => {
    it('để trống -> yêu cầu nhập', () => {
      expect(messagesByField(values({ value: '' })).value).toBe('Vui lòng nhập giá trị giảm');
    });

    it('không phải số -> báo số không hợp lệ (không lộ lỗi "nan" của Zod)', () => {
      expect(messagesByField(values({ value: 'abc' })).value).toBe('Vui lòng nhập số hợp lệ');
    });

    it('PERCENT vượt 100 -> tái dùng luật của BE', () => {
      expect(messagesByField(values({ value: '150' })).value).toBe('Phần trăm giảm tối đa là 100');
    });

    it('PERCENT đúng 100 hợp lệ', () => {
      expect(voucherFormSchema.safeParse(values({ value: '100' })).success).toBe(true);
    });

    it('giá trị 0 hoặc âm bị từ chối', () => {
      expect(messagesByField(values({ value: '0' })).value).toBeDefined();
      expect(messagesByField(values({ value: '-5' })).value).toBeDefined();
    });

    it('FIXED phải là số nguyên đồng', () => {
      expect(messagesByField(values({ type: 'FIXED', value: '50000.5' })).value).toBe(
        'Số tiền giảm phải là số nguyên đồng',
      );
      expect(voucherFormSchema.safeParse(values({ type: 'FIXED', value: '50000' })).success).toBe(
        true,
      );
    });
  });

  describe('các ô tuỳ chọn', () => {
    it.each(['minOrderAmount', 'maxDiscountAmount', 'usageLimit', 'perUserLimit'] as const)(
      '%s nhập chữ -> báo số không hợp lệ',
      (field) => {
        expect(messagesByField(values({ [field]: 'abc' }))[field]).toBe('Vui lòng nhập số hợp lệ');
      },
    );

    it('usageLimit/perUserLimit phải là số nguyên ≥ 1', () => {
      expect(messagesByField(values({ usageLimit: '0' })).usageLimit).toBeDefined();
      expect(messagesByField(values({ perUserLimit: '1.5' })).perUserLimit).toBeDefined();
    });

    it('lỗi định dạng ở nhiều ô hiện cùng lúc, không che nhau', () => {
      const messages = messagesByField(
        values({ code: 'ab', minOrderAmount: 'x', usageLimit: 'y' }),
      );

      expect(Object.keys(messages).sort()).toEqual(['code', 'minOrderAmount', 'usageLimit']);
    });
  });

  describe('ngày hết hạn', () => {
    it('ở quá khứ -> bị từ chối', () => {
      expect(messagesByField(values({ expiresAt: '2020-01-01T00:00' })).expiresAt).toBe(
        'Ngày hết hạn phải ở tương lai',
      );
    });

    it('sai định dạng -> bị từ chối', () => {
      expect(messagesByField(values({ expiresAt: 'ngày mai' })).expiresAt).toBe(
        'Ngày hết hạn không hợp lệ',
      );
    });

    it('ở tương lai hợp lệ, để trống cũng hợp lệ', () => {
      expect(voucherFormSchema.safeParse(values({ expiresAt: '2030-01-01T00:00' })).success).toBe(
        true,
      );
      expect(voucherFormSchema.safeParse(values({ expiresAt: '' })).success).toBe(true);
    });
  });
});
