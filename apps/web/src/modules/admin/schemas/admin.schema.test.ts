import { adminUpdateShopStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_REFUND_REFERENCE_MAX_LENGTH,
  ADMIN_SHOP_REASON_MAX_LENGTH,
  adminDecideRefundRequestSchema,
  adminMarkRefundCompletedSchema,
  adminRefundPaymentSchema,
  shopReasonFormSchema,
} from './admin.schema';

describe('shopReasonFormSchema', () => {
  it('lý do hợp lệ -> giữ nguyên (đã trim)', () => {
    const result = shopReasonFormSchema.safeParse({ reason: '  Vi phạm chính sách  ' });

    expect(result.success && result.data.reason).toBe('Vi phạm chính sách');
  });

  it.each(['', '   ', '\n\t '])(
    'lý do %j (trống/chỉ khoảng trắng) -> key i18n "bắt buộc"',
    (reason) => {
      const result = shopReasonFormSchema.safeParse({ reason });

      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0].message).toBe(
        'admin.validationReasonRequired',
      );
    },
  );

  it(`đúng ${ADMIN_SHOP_REASON_MAX_LENGTH} ký tự -> hợp lệ, ${ADMIN_SHOP_REASON_MAX_LENGTH + 1} -> key i18n "quá dài"`, () => {
    expect(
      shopReasonFormSchema.safeParse({ reason: 'a'.repeat(ADMIN_SHOP_REASON_MAX_LENGTH) }).success,
    ).toBe(true);

    const result = shopReasonFormSchema.safeParse({
      reason: 'a'.repeat(ADMIN_SHOP_REASON_MAX_LENGTH + 1),
    });
    expect(!result.success && result.error.issues[0].message).toBe('admin.validationReasonTooLong');
  });

  // Form và BE phải cùng luật: mọi lý do form chấp nhận thì body gửi lên BE cũng phải qua validate
  // (và ngược lại 2 key lỗi trùng nhau, nên bản dịch dùng chung).
  it.each(['REJECTED', 'SUSPENDED'] as const)(
    'đầu ra của form luôn được schema BE chấp nhận với status %s',
    (status) => {
      const form = shopReasonFormSchema.parse({ reason: '  Hàng cấm  ' });

      const body = adminUpdateShopStatusSchema.safeParse({ status, reason: form.reason });

      expect(body.success && body.data).toEqual({ status, reason: 'Hàng cấm' });
    },
  );

  it('thiếu field reason -> không hợp lệ', () => {
    expect(shopReasonFormSchema.safeParse({}).success).toBe(false);
  });
});

describe('adminDecideRefundRequestSchema', () => {
  it('duyệt: ghi chú tuỳ chọn, "" coi như chưa nhập', () => {
    expect(adminDecideRefundRequestSchema.parse({ decision: 'APPROVE' })).toEqual({
      decision: 'APPROVE',
      note: undefined,
    });
    expect(adminDecideRefundRequestSchema.parse({ decision: 'APPROVE', note: '' })).toEqual({
      decision: 'APPROVE',
      note: undefined,
    });
  });

  it.each([undefined, '', '   '])(
    'từ chối mà ghi chú %j -> lỗi gắn đúng field note (key order.validationReasonRequired)',
    (note) => {
      const result = adminDecideRefundRequestSchema.safeParse({ decision: 'REJECT', note });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['note']);
        expect(result.error.issues[0].message).toBe('order.validationReasonRequired');
      }
    },
  );

  it('từ chối kèm ghi chú thì hợp lệ (đã trim); quyết định lạ không hợp lệ', () => {
    expect(
      adminDecideRefundRequestSchema.parse({ decision: 'REJECT', note: '  Thiếu ảnh  ' }),
    ).toEqual({ decision: 'REJECT', note: 'Thiếu ảnh' });
    expect(adminDecideRefundRequestSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
  });
});

describe('adminMarkRefundCompletedSchema', () => {
  it('mã tham chiếu hợp lệ -> giữ nguyên (đã trim)', () => {
    expect(adminMarkRefundCompletedSchema.parse({ reference: '  VNP-998  ' })).toEqual({
      reference: 'VNP-998',
    });
  });

  it.each([{}, { reference: '' }, { reference: '   ' }])(
    'mã bắt buộc: %j -> key i18n admin.validationRefundReferenceRequired',
    (input) => {
      const result = adminMarkRefundCompletedSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('admin.validationRefundReferenceRequired');
      }
    },
  );

  it('đúng giới hạn thì hợp lệ, vượt 1 ký tự -> admin.validationRefundReferenceTooLong', () => {
    expect(
      adminMarkRefundCompletedSchema.safeParse({
        reference: 'a'.repeat(ADMIN_REFUND_REFERENCE_MAX_LENGTH),
      }).success,
    ).toBe(true);

    const result = adminMarkRefundCompletedSchema.safeParse({
      reference: 'a'.repeat(ADMIN_REFUND_REFERENCE_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('admin.validationRefundReferenceTooLong');
    }
  });
});

describe('adminRefundPaymentSchema', () => {
  it('lý do tuỳ chọn, "" coi như chưa nhập', () => {
    expect(adminRefundPaymentSchema.parse({})).toEqual({ reason: undefined });
    expect(adminRefundPaymentSchema.parse({ reason: '' })).toEqual({ reason: undefined });
    expect(adminRefundPaymentSchema.parse({ reason: ' Khách trả hai lần ' })).toEqual({
      reason: 'Khách trả hai lần',
    });
  });

  it('lý do vượt 500 ký tự -> admin.validationReasonTooLong', () => {
    const result = adminRefundPaymentSchema.safeParse({ reason: 'a'.repeat(501) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('admin.validationReasonTooLong');
    }
  });
});
