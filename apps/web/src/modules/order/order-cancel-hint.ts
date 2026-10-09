import type { OrderDetail } from './types';

export type CancelBlockedReasonKey = 'cancelBlockedProcessing';

// Shop đã nhận xử lý nhưng chưa giao đi. KHÔNG gồm SHIPPING: hàng đã ra khỏi shop, việc người mua cần làm là
// "Đã nhận hàng"; sau đó là trả hàng/hoàn tiền (luồng khác), không phải nút Hủy — một nút khoá kèm lời giải
// thích cạnh nút chính chỉ gây rối.
const PROCESSING_STATUSES: readonly OrderDetail['status'][] = ['CONFIRMED', 'PACKED'];

// Khi người mua KHÔNG hủy được và cũng KHÔNG gửi được yêu cầu hủy (cả `canCancel` và `canRequestCancel` đều tắt)
// nhưng đơn vẫn ở trạng thái họ có thể muốn hủy, UI hiện nút Hủy bị khoá kèm lý do (không ẩn im lặng — Week8.md
// 1.5/3.3). Hàm chỉ chọn CÂU GIẢI THÍCH; quyền hủy/gửi yêu cầu luôn theo cờ của BE.
//
// Từ Tuần 9, đơn CONFIRMED/PACKED gửi được yêu cầu hủy (`canRequestCancel`) và đơn đã trả online hủy được
// ngay khi còn chờ xác nhận (`canCancel`), nên câu cũ "hủy đơn kèm hoàn tiền sẽ có ở bản cập nhật tới" không
// còn nhánh nào dẫn tới. Còn lại hiếm gặp: đơn đã xác nhận nhưng không gửi được yêu cầu mà KHÔNG có yêu cầu nào
// đang tồn tại (vd đơn online chưa ghi nhận thanh toán thành công — BE từ chối PAYMENT_NOT_COLLECTED).
//   - null: không cần gợi ý (hủy được/gửi được yêu cầu; hoặc đã có yêu cầu — thẻ yêu cầu ở chi tiết đơn tự
//     nói rõ trạng thái; hoặc đơn ở trạng thái cuối/chưa tới lúc nghĩ tới hủy).
export function getCancelBlockedReasonKey(
  order: Pick<OrderDetail, 'canCancel' | 'canRequestCancel' | 'status' | 'refundRequest'>,
): CancelBlockedReasonKey | null {
  if (order.canCancel || order.canRequestCancel) return null;
  if (order.refundRequest) return null;
  if (PROCESSING_STATUSES.includes(order.status)) return 'cancelBlockedProcessing';
  return null;
}
