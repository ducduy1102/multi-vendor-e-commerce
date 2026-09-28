import { describe, expect, it } from 'vitest';

import { classifyVoucherError } from './voucher-error';

describe('classifyVoucherError', () => {
  it.each([
    ['VOUCHER_NOT_FOUND', 'cart.voucherNotFound'],
    ['VOUCHER_INACTIVE', 'cart.voucherInactive'],
    ['VOUCHER_EXPIRED', 'cart.voucherExpired'],
    ['VOUCHER_USAGE_LIMIT_REACHED', 'cart.voucherUsageLimit'],
    ['VOUCHER_PER_USER_LIMIT_REACHED', 'cart.voucherPerUserLimit'],
    ['VOUCHER_NOT_APPLICABLE', 'cart.voucherNotApplicable'],
  ] as const)('%s -> %s', (code, key) => {
    expect(classifyVoucherError({ code, details: undefined })).toEqual({ key });
  });

  it('VOUCHER_BELOW_MINIMUM -> tách minAmount (số nguyên VND) từ details để FE tự định dạng', () => {
    expect(
      classifyVoucherError({ code: 'VOUCHER_BELOW_MINIMUM', details: { minAmount: 300000 } }),
    ).toEqual({
      key: 'cart.voucherMinOrder',
      minAmount: 300000,
    });
  });

  it('VOUCHER_BELOW_MINIMUM nhưng details sai hình dạng -> vẫn đúng key, minAmount undefined', () => {
    expect(
      classifyVoucherError({ code: 'VOUCHER_BELOW_MINIMUM', details: { wrong: 'shape' } }),
    ).toEqual({
      key: 'cart.voucherMinOrder',
      minAmount: undefined,
    });
  });

  it('không có code (lỗi cũ chưa di chuyển sang mã) -> lỗi chung, không vỡ', () => {
    expect(classifyVoucherError({ code: undefined, details: undefined })).toEqual({
      key: 'cart.voucherGenericError',
    });
  });

  it('mã lạ/không thuộc nhóm voucher (vd CART_FULL lọt vào do BE đổi chỗ ném lỗi) -> lỗi chung', () => {
    expect(classifyVoucherError({ code: 'CART_FULL', details: { maxLines: 50 } })).toEqual({
      key: 'cart.voucherGenericError',
    });
  });
});
