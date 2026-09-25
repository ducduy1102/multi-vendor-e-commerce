import { describe, expect, it } from 'vitest';

import { classifyVoucherError } from './voucher-error';

describe('classifyVoucherError', () => {
  it.each([
    ['Voucher not found', 'voucherNotFound'],
    ['Voucher is not active', 'voucherInactive'],
    ['Voucher has expired', 'voucherExpired'],
    ['Voucher usage limit has been reached', 'voucherUsageLimit'],
    ['You have reached the usage limit for this voucher', 'voucherPerUserLimit'],
    ['Voucher does not apply to any item in your cart', 'voucherNotApplicable'],
  ])('"%s" -> %s', (message, key) => {
    expect(classifyVoucherError(message)).toEqual({ key });
  });

  it('dưới mức tối thiểu -> tách số tiền tối thiểu ra để FE tự định dạng', () => {
    expect(classifyVoucherError('Order amount is below the voucher minimum (300000)')).toEqual({
      key: 'voucherMinOrder',
      minAmount: '300000',
    });
  });

  it('mức tối thiểu có phần thập phân vẫn nhận diện được', () => {
    expect(classifyVoucherError('Order amount is below the voucher minimum (150000.5)')).toEqual({
      key: 'voucherMinOrder',
      minAmount: '150000.5',
    });
  });

  it('bỏ khoảng trắng thừa hai đầu', () => {
    expect(classifyVoucherError('  Voucher has expired  ')).toEqual({ key: 'voucherExpired' });
  });

  it('message lạ (BE đổi câu chữ) -> rơi về lỗi chung, không lộ tiếng Anh, không vỡ', () => {
    expect(classifyVoucherError('Something else entirely')).toEqual({
      key: 'voucherGenericError',
    });
    expect(classifyVoucherError('')).toEqual({ key: 'voucherGenericError' });
  });
});
