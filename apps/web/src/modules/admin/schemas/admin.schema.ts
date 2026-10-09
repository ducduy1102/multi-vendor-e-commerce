import { ADMIN_SHOP_REASON_MAX_LENGTH } from '@ecommerce/types';
import { z } from 'zod';

export { ADMIN_SHOP_REASON_MAX_LENGTH };

// Hoàn tiền: dùng thẳng schema BE (Week9.md 2.9) — quyết định yêu cầu (ghi chú bắt buộc khi từ chối, ràng buộc
// bằng `superRefine` đặt SAU object nên input/output type vẫn là { decision, note? }), mã tham chiếu khi ghi
// nhận hoàn tay (bắt buộc) và lý do hoàn thanh toán bất thường (tuỳ chọn). Message lỗi là key i18n
// `admin.validation*` / `order.validation*`, dịch khi hiển thị; `""` từ input bỏ trống được coi là chưa nhập.
export {
  ADMIN_REFUND_REFERENCE_MAX_LENGTH,
  adminDecideRefundRequestSchema,
  adminMarkRefundCompletedSchema,
  adminRefundPaymentSchema,
} from '@ecommerce/types';

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
