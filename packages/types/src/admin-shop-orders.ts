import { z } from 'zod';
import { adminUserReasonSchema } from './admin-user';

// Hủy hàng loạt đơn chưa giao của shop đang bị khoá (Week11.md 4.1, D2). File này là HỢP ĐỒNG dùng chung của BE và FE:
// schema body và hình dạng kết quả — không có logic nghiệp vụ. Thực thi thật (chọn đơn, hủy từng đơn, hoàn tiền, nhật ký
// quản trị) nằm ở `AdminShopOrdersService`.

// Số đơn tối đa xử lý trong MỘT lần gọi. Hủy tuần tự từng đơn, mỗi đơn online còn gọi cổng thanh toán (có thể chậm tới giới
// hạn thời gian của cổng), nên một request không được gánh cả trăm đơn — vượt thời gian chờ của proxy thì Admin không biết
// việc đã làm tới đâu. Shop còn đơn thì kết quả có `remaining > 0` và Admin bấm chạy tiếp (idempotent: đơn đã hủy không còn
// được chọn).
export const ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE = 20;

// Lý do (bắt buộc, ≤ 500 ký tự, một đoạn văn bản an toàn): ghi vào dòng thời gian của từng đơn, vào email gửi người mua và
// vào nhật ký quản trị — cùng luật với lý do khoá tài khoản nên dùng lại đúng schema đó (message lỗi là key i18n
// `admin.validationReason*`).
export const adminCancelShopOrdersSchema = z.object({ reason: adminUserReasonSchema });
export type AdminCancelShopOrdersInput = z.infer<typeof adminCancelShopOrdersSchema>;

// Mã lỗi của một đơn không hủy được: mã nghiệp vụ của BE (`ORDER_INVALID_TRANSITION`, `PAYMENT_NOT_REFUNDABLE`...) hoặc
// `UNKNOWN` cho lỗi không lường trước — KHÔNG bao giờ là thông điệp lỗi gốc (có thể mang dữ liệu nội bộ).
export const adminCancelShopOrdersFailureSchema = z.object({
  orderId: z.string(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
});
export type AdminCancelShopOrdersFailure = z.infer<typeof adminCancelShopOrdersFailureSchema>;

// Đơn ĐÃ hủy nhưng cổng thanh toán TỪ CHỐI khoản hoàn (`FAILED`) — vd sandbox VNPay chỉ cho MỘT lần hoàn mỗi giao dịch nên
// đơn thứ hai cùng giao dịch rơi vào đây. Việc hủy (trạng thái, kho, voucher) đã đúng; chỉ tiền chưa về, Admin xử lý tiếp ở
// màn hoàn tiền (thử lại hoặc ghi nhận đã hoàn tay). `amount` là số VND nguyên dạng chuỗi như mọi response tiền. Khoản
// còn `PENDING` (cổng chưa trả lời) KHÔNG nằm ở đây: job hoàn tiền tự thử lại, chỉ được đếm ở `refundsPending`.
export const adminCancelShopOrdersManualRefundSchema = z.object({
  orderId: z.string(),
  refundId: z.string(),
  amount: z.string(),
});
export type AdminCancelShopOrdersManualRefund = z.infer<
  typeof adminCancelShopOrdersManualRefundSchema
>;

export const adminCancelShopOrdersResultSchema = z.object({
  // Số đơn đã hủy thành công trong LẦN GỌI NÀY.
  cancelled: z.number().int().nonnegative(),
  failed: z.array(adminCancelShopOrdersFailureSchema),
  needsManualRefund: z.array(adminCancelShopOrdersManualRefundSchema),
  // Số đơn đã hủy mà khoản hoàn còn chờ cổng trả lời (job tự thử lại, không cần Admin làm gì ngay).
  refundsPending: z.number().int().nonnegative(),
  // Số đơn chưa giao còn lại SAU lần gọi (gồm cả đơn lỗi và đơn vượt giới hạn mỗi lần). > 0 ⇒ có thể chạy tiếp.
  remaining: z.number().int().nonnegative(),
});
export type AdminCancelShopOrdersResult = z.infer<typeof adminCancelShopOrdersResultSchema>;
