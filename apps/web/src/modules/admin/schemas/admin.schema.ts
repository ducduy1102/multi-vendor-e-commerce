import { ADMIN_SHOP_REASON_MAX_LENGTH } from '@ecommerce/types';
import { z } from 'zod';

export { ADMIN_SHOP_REASON_MAX_LENGTH };

// Form hộp thoại từ chối/khoá chỉ có 1 field `reason` BẮT BUỘC. Không dùng thẳng
// adminUpdateShopStatusSchema vì schema đó mang cả `status` (+ superRefine, không `.pick()` được) và
// coi lý do là tuỳ chọn với duyệt/mở khoá. Dùng chung hằng độ dài và 2 key i18n `admin.validation*`
// với schema BE (admin.schema.test.ts kiểm đầu ra form luôn được schema BE chấp nhận). `.trim()`
// nên chuỗi chỉ toàn khoảng trắng coi như chưa nhập — BE cũng làm y hệt.
export const shopReasonFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'admin.validationReasonRequired')
    .max(ADMIN_SHOP_REASON_MAX_LENGTH, 'admin.validationReasonTooLong'),
});
export type ShopReasonFormInput = z.infer<typeof shopReasonFormSchema>;
