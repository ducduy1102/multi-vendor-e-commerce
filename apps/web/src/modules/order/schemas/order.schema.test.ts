import { describe, expect, it } from 'vitest';

import { cancelOrderSchema, rejectOrderSchema, shipOrderSchema } from './order.schema';

// Regression: React Hook Form gửi "" cho input bỏ trống (không phải undefined) — field tuỳ chọn
// phải coi "" là chưa nhập, không lọt field rác vào payload gửi BE.
describe('cancelOrderSchema', () => {
  it('lý do bỏ trống/khoảng trắng coi như chưa nhập', () => {
    expect(cancelOrderSchema.parse({})).toEqual({ reason: undefined });
    expect(cancelOrderSchema.parse({ reason: '' })).toEqual({ reason: undefined });
    expect(cancelOrderSchema.parse({ reason: '   ' })).toEqual({ reason: undefined });
  });

  it('giữ lý do đã nhập (đã trim)', () => {
    expect(cancelOrderSchema.parse({ reason: '  Đặt nhầm  ' })).toEqual({ reason: 'Đặt nhầm' });
  });

  it('lý do quá dài -> key i18n order.validationReasonTooLong', () => {
    const result = cancelOrderSchema.safeParse({ reason: 'a'.repeat(501) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('order.validationReasonTooLong');
    }
  });
});

describe('rejectOrderSchema', () => {
  it.each([{}, { reason: '' }, { reason: '   ' }])(
    'lý do bắt buộc: %j -> key i18n order.validationReasonRequired',
    (input) => {
      const result = rejectOrderSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('order.validationReasonRequired');
      }
    },
  );

  it('có lý do hợp lệ thì qua', () => {
    expect(rejectOrderSchema.parse({ reason: 'Hết hàng' })).toEqual({ reason: 'Hết hàng' });
  });
});

describe('shipOrderSchema', () => {
  it('carrier/trackingCode đều tuỳ chọn, chuỗi rỗng coi như chưa nhập', () => {
    expect(shipOrderSchema.parse({})).toEqual({ carrier: undefined, trackingCode: undefined });
    expect(shipOrderSchema.parse({ carrier: '', trackingCode: '' })).toEqual({
      carrier: undefined,
      trackingCode: undefined,
    });
  });

  it('giữ giá trị đã nhập', () => {
    expect(shipOrderSchema.parse({ carrier: 'GHN', trackingCode: 'GHN123' })).toEqual({
      carrier: 'GHN',
      trackingCode: 'GHN123',
    });
  });

  it('quá 100 ký tự -> key i18n riêng cho từng field', () => {
    const long = 'a'.repeat(101);
    const carrier = shipOrderSchema.safeParse({ carrier: long });
    const tracking = shipOrderSchema.safeParse({ trackingCode: long });

    expect(carrier.success).toBe(false);
    expect(tracking.success).toBe(false);
    if (!carrier.success && !tracking.success) {
      expect(carrier.error.issues[0].message).toBe('order.validationCarrierTooLong');
      expect(tracking.error.issues[0].message).toBe('order.validationTrackingCodeTooLong');
    }
  });
});
