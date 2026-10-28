import {
  ADMIN_SHOP_REASON_MAX_LENGTH,
  ADMIN_USER_REASON_MAX_LENGTH,
  adminUserReasonSchema,
} from '@ecommerce/types';
import { z } from 'zod';

export { ADMIN_SHOP_REASON_MAX_LENGTH, ADMIN_USER_REASON_MAX_LENGTH };

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

// Form hộp thoại khoá / cấm / mở lại / gỡ cấm tài khoản: MỘT field `reason` BẮT BUỘC ở cả bốn hành động (lý do đi vào nhật ký
// quản trị và email gửi cho chủ tài khoản). Dùng thẳng `adminUserReasonSchema` của BE (chuẩn hoá xuống dòng, cắt khoảng trắng
// hai đầu, 1..500 ký tự, chặn ký tự điều khiển) nên đầu ra của form luôn được BE chấp nhận; message lỗi là key i18n
// `admin.validation*`. Input và output cùng kiểu `string` nên khớp generic `useForm<T>` của zodResolver dù schema có transform.
export const userReasonFormSchema = z.object({ reason: adminUserReasonSchema });
export type UserReasonFormInput = z.infer<typeof userReasonFormSchema>;

// Form hộp thoại hủy hàng loạt đơn của shop (Week11.md 4.1): lý do bắt buộc (cùng luật lý do khoá tài khoản) và PHẢI gõ lại đúng
// tên shop — thao tác không hoàn tác được và động tới nhiều người mua cùng lúc, nên một cú bấm nhầm không đủ. So sánh sau khi cắt
// khoảng trắng hai đầu và chuẩn hoá Unicode NFC (cùng một tên tiếng Việt gõ bằng dấu rời hay dấu liền đều khớp), PHÂN BIỆT chữ
// hoa/thường như mọi ô "gõ tên để xác nhận". Tên shop khác nhau theo từng shop nên là hàm tạo schema chứ không phải hằng.
const normaliseName = (value: string) => value.trim().normalize('NFC');

export function createCancelShopOrdersFormSchema(shopName: string) {
  return z.object({
    reason: adminUserReasonSchema,
    confirmName: z.string().refine((value) => normaliseName(value) === normaliseName(shopName), {
      message: 'admin.validationShopNameMismatch',
    }),
  });
}
export type CancelShopOrdersFormInput = z.infer<
  ReturnType<typeof createCancelShopOrdersFormSchema>
>;
