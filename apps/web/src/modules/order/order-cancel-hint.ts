import type { OrderDetail } from './types';

export type CancelBlockedReasonKey = 'cancelBlockedPaidOnline' | 'cancelBlockedProcessing';

// Shop đã nhận xử lý nhưng chưa giao đi — hủy ở đây là việc của Tuần 9 (kèm hoàn tiền), nên nút
// khoá báo trước một tính năng sắp có. KHÔNG gồm SHIPPING: hàng đã ra khỏi shop, việc người mua cần
// làm là "Đã nhận hàng"; sau đó là trả hàng/hoàn tiền (luồng khác), không phải nút Hủy — một nút
// khoá kèm câu "shop đã bắt đầu xử lý" cạnh nút chính chỉ gây rối.
const PROCESSING_STATUSES: readonly OrderDetail['status'][] = ['CONFIRMED', 'PACKED'];

// Khi BE KHÔNG cho hủy (canCancel = false) nhưng đơn vẫn đang ở trạng thái mà người mua có thể
// muốn hủy, UI hiện nút Hủy bị khoá kèm lý do (không ẩn im lặng — Week8.md 1.5/3.3). Hàm chỉ chọn
// CÂU GIẢI THÍCH; quyền hủy luôn theo cờ canCancel của BE: khi Tuần 9 mở hủy đơn đã thanh
// toán/đã xác nhận, BE bật cờ lên thì gợi ý này tự biến mất, không phải sửa FE.
//   - null: không cần gợi ý (hủy được, hoặc đơn đã ở trạng thái cuối/chưa tới lúc nghĩ tới hủy).
export function getCancelBlockedReasonKey(
  order: Pick<OrderDetail, 'canCancel' | 'status' | 'paymentMethod'>,
): CancelBlockedReasonKey | null {
  if (order.canCancel) return null;
  if (order.status === 'PENDING' && order.paymentMethod !== 'COD') return 'cancelBlockedPaidOnline';
  if (PROCESSING_STATUSES.includes(order.status)) return 'cancelBlockedProcessing';
  return null;
}
