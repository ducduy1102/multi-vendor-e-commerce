import {
  adminCancelShopOrdersSchema,
  adminUpdateShopStatusSchema,
  reactivateUserSchema,
  suspendUserSchema,
} from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_REFUND_REFERENCE_MAX_LENGTH,
  ADMIN_SHOP_REASON_MAX_LENGTH,
  adminDecideRefundRequestSchema,
  adminMarkRefundCompletedSchema,
  adminRefundPaymentSchema,
  createCancelShopOrdersFormSchema,
  shopReasonFormSchema,
  userReasonFormSchema,
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

describe('userReasonFormSchema', () => {
  it('lý do hợp lệ -> giữ nguyên (đã trim)', () => {
    const result = userReasonFormSchema.safeParse({ reason: '  Vi phạm điều khoản  ' });

    expect(result.success && result.data.reason).toBe('Vi phạm điều khoản');
  });

  it.each(['', '   ', '\n\t '])(
    'lý do %j (trống/chỉ khoảng trắng) -> key i18n "bắt buộc"',
    (reason) => {
      const result = userReasonFormSchema.safeParse({ reason });

      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0].message).toBe(
        'admin.validationReasonRequired',
      );
    },
  );

  it('lý do dài đúng 500 ký tự hợp lệ, 501 thì báo "quá dài"', () => {
    expect(userReasonFormSchema.safeParse({ reason: 'a'.repeat(500) }).success).toBe(true);

    const result = userReasonFormSchema.safeParse({ reason: 'a'.repeat(501) });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe('admin.validationReasonTooLong');
  });

  it('chặn ký tự điều khiển / bidi-override, cho phép xuống dòng', () => {
    expect(userReasonFormSchema.safeParse({ reason: 'dòng 1\ndòng 2' }).success).toBe(true);
    for (const reason of ['a\u0000b', 'a\u202Eb', 'a\tb']) {
      const result = userReasonFormSchema.safeParse({ reason });
      expect(result.success, JSON.stringify(reason)).toBe(false);
      expect(!result.success && result.error.issues[0].message).toBe(
        'admin.validationReasonUnsafe',
      );
    }
  });

  it('đầu ra của form luôn được schema BE chấp nhận (khoá/cấm và mở lại), không lệch luật', () => {
    for (const reason of ['  Lý do  ', 'dòng 1\r\ndòng 2', 'a'.repeat(500)]) {
      const form = userReasonFormSchema.parse({ reason });

      expect(suspendUserSchema.safeParse({ status: 'SUSPENDED', ...form }).success).toBe(true);
      expect(suspendUserSchema.safeParse({ status: 'BANNED', ...form }).success).toBe(true);
      expect(reactivateUserSchema.safeParse(form).success).toBe(true);
    }
  });
});

describe('createCancelShopOrdersFormSchema', () => {
  const schema = createCancelShopOrdersFormSchema('Thời Trang Thảo');
  const valid = { reason: 'Shop vi phạm', confirmName: 'Thời Trang Thảo' };

  it('lý do + tên shop gõ đúng -> hợp lệ, lý do được chuẩn hoá (trim)', () => {
    const result = schema.safeParse({ ...valid, reason: '  Shop vi phạm  ' });

    expect(result.success && result.data.reason).toBe('Shop vi phạm');
  });

  it.each([
    ['để trống', ''],
    ['sai một ký tự', 'Thời Trang Thao'],
    ['sai chữ hoa/thường', 'thời trang thảo'],
    ['chỉ một phần', 'Thời Trang'],
    ['thừa chữ', 'Thời Trang Thảo 2'],
  ])('tên shop %s -> key i18n "không khớp" ở field confirmName', (_name, confirmName) => {
    const result = schema.safeParse({ ...valid, confirmName });

    expect(result.success).toBe(false);
    const issue = !result.success ? result.error.issues[0] : null;
    expect(issue?.path).toEqual(['confirmName']);
    expect(issue?.message).toBe('admin.validationShopNameMismatch');
  });

  it('khoảng trắng hai đầu và dạng Unicode (dấu rời / dấu liền) không làm lệch tên', () => {
    expect(schema.safeParse({ ...valid, confirmName: '  Thời Trang Thảo  ' }).success).toBe(true);
    expect(
      schema.safeParse({ ...valid, confirmName: 'Thời Trang Thảo'.normalize('NFD') }).success,
    ).toBe(true);
  });

  it('schema theo TỪNG shop: tên của shop khác không dùng được', () => {
    const other = createCancelShopOrdersFormSchema('Shop Khác');

    expect(other.safeParse(valid).success).toBe(false);
    expect(other.safeParse({ ...valid, confirmName: 'Shop Khác' }).success).toBe(true);
  });

  it.each(['', '   ', 'a'.repeat(501), 'a\u0000b'])(
    'lý do %j không hợp lệ -> báo ở field reason',
    (reason) => {
      const result = schema.safeParse({ ...valid, reason });

      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0].path).toEqual(['reason']);
    },
  );

  it('đầu ra của form luôn được schema BE chấp nhận (cùng luật lý do), không lệch', () => {
    for (const reason of ['  Lý do  ', 'dòng 1\r\ndòng 2', 'a'.repeat(500)]) {
      const form = schema.parse({ ...valid, reason });

      expect(adminCancelShopOrdersSchema.safeParse({ reason: form.reason }).success).toBe(true);
    }
  });
});
