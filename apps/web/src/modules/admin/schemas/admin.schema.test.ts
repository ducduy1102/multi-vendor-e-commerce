import { adminUpdateShopStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { ADMIN_SHOP_REASON_MAX_LENGTH, shopReasonFormSchema } from './admin.schema';

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
