import { describe, expect, it } from 'vitest';

import {
  REFUND_REASON_CODES_BY_KIND,
  approveRefundRequestSchema,
  cancelOrderSchema,
  createRefundRequestSchema,
  rejectOrderSchema,
  rejectRefundRequestSchema,
  sellerCancelOrderSchema,
  shipOrderSchema,
} from './order.schema';

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

describe('sellerCancelOrderSchema', () => {
  it.each([{}, { reason: '' }, { reason: '   ' }])(
    'lý do bắt buộc như từ chối đơn: %j -> key i18n order.validationReasonRequired',
    (input) => {
      const result = sellerCancelOrderSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('order.validationReasonRequired');
      }
    },
  );

  it('giữ lý do đã nhập (đã trim)', () => {
    expect(sellerCancelOrderSchema.parse({ reason: '  Hết hàng  ' })).toEqual({
      reason: 'Hết hàng',
    });
  });
});

// Form yêu cầu hủy/trả hàng: React Hook Form gửi "" cho ghi chú bỏ trống; chọn OTHER thì ghi chú bắt buộc.
describe('createRefundRequestSchema', () => {
  it('lý do trong danh sách + ghi chú bỏ trống ("" từ input) -> ghi chú coi như chưa nhập', () => {
    expect(createRefundRequestSchema.parse({ reasonCode: 'DAMAGED', reasonNote: '' })).toEqual({
      reasonCode: 'DAMAGED',
      reasonNote: undefined,
    });
    expect(createRefundRequestSchema.parse({ reasonCode: 'DAMAGED' })).toEqual({
      reasonCode: 'DAMAGED',
      reasonNote: undefined,
    });
  });

  it('giữ ghi chú đã nhập (đã trim)', () => {
    expect(
      createRefundRequestSchema.parse({ reasonCode: 'WRONG_ITEM', reasonNote: '  Sai màu  ' }),
    ).toEqual({ reasonCode: 'WRONG_ITEM', reasonNote: 'Sai màu' });
  });

  it('chưa chọn lý do (undefined / "") -> key i18n order.validationRefundReasonRequired hoặc ...Invalid', () => {
    const missing = createRefundRequestSchema.safeParse({});
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues[0].message).toBe('order.validationRefundReasonRequired');
    }

    // <select> mặc định gửi "" — mã không có trong danh sách là "sai giá trị", không phải "thiếu".
    const empty = createRefundRequestSchema.safeParse({ reasonCode: '' });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0].message).toBe('order.validationRefundReasonInvalid');
    }
  });

  it('chọn OTHER mà không ghi chú -> lỗi gắn đúng field reasonNote (key order.validationRefundNoteRequired)', () => {
    for (const reasonNote of [undefined, '', '   ']) {
      const result = createRefundRequestSchema.safeParse({ reasonCode: 'OTHER', reasonNote });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['reasonNote']);
        expect(result.error.issues[0].message).toBe('order.validationRefundNoteRequired');
      }
    }
  });

  it('OTHER kèm ghi chú thì hợp lệ', () => {
    expect(
      createRefundRequestSchema.safeParse({ reasonCode: 'OTHER', reasonNote: 'Lý do khác' })
        .success,
    ).toBe(true);
  });

  it('ghi chú vượt 500 ký tự -> order.validationRefundNoteTooLong', () => {
    const result = createRefundRequestSchema.safeParse({
      reasonCode: 'DAMAGED',
      reasonNote: 'a'.repeat(501),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('order.validationRefundNoteTooLong');
    }
  });

  it('danh sách lý do theo loại: mỗi loại có OTHER và mọi mã đều được schema chấp nhận (khớp để dựng <select>)', () => {
    for (const codes of Object.values(REFUND_REASON_CODES_BY_KIND)) {
      expect(codes).toContain('OTHER');
      for (const reasonCode of codes) {
        const reasonNote = reasonCode === 'OTHER' ? 'x' : undefined;
        expect(createRefundRequestSchema.safeParse({ reasonCode, reasonNote }).success).toBe(true);
      }
    }
  });
});

describe('approveRefundRequestSchema', () => {
  it('ghi chú tuỳ chọn, "" coi như chưa nhập', () => {
    expect(approveRefundRequestSchema.parse({})).toEqual({ note: undefined });
    expect(approveRefundRequestSchema.parse({ note: '' })).toEqual({ note: undefined });
    expect(approveRefundRequestSchema.parse({ note: ' Đồng ý ' })).toEqual({ note: 'Đồng ý' });
  });
});

describe('rejectRefundRequestSchema', () => {
  it.each([{}, { note: '' }, { note: '   ' }])(
    'ghi chú bắt buộc (người mua cần biết vì sao): %j -> key i18n order.validationReasonRequired',
    (input) => {
      const result = rejectRefundRequestSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('order.validationReasonRequired');
      }
    },
  );

  it('ghi chú vượt 500 ký tự -> order.validationReasonTooLong', () => {
    const result = rejectRefundRequestSchema.safeParse({ note: 'a'.repeat(501) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('order.validationReasonTooLong');
    }
  });
});
