import type { Notification, NotificationType } from './types';

// Toast khi có thông báo MỚI tới lúc người dùng đang mở tab (Week10.md 8.1): chỉ cho loại QUAN TRỌNG — cần hành động
// ngay hoặc là kết quả của việc người dùng đang chờ — vì toast mọi thứ (mỗi lần shop xác nhận/giao đơn, mỗi đánh giá) biến
// chuông thành tiếng ồn, còn chuông + huy hiệu đã đủ cho phần còn lại.
//
//  - Có (cần hành động): đơn mới (chủ shop), yêu cầu hủy/trả hàng mới và khiếu nại (chủ shop, Admin), shop chờ duyệt, kháng
//    nghị mới và báo cáo vi phạm mới (Admin).
//  - Có (kết quả đang chờ): yêu cầu được duyệt/từ chối, Admin quyết định, đã hoàn tiền, trạng thái shop, đơn bị hủy, kết quả
//    kháng nghị.
//  - Không: đơn được xác nhận/giao/hoàn tất (tiến độ thường lệ), đánh giá mới/được trả lời.
const TOAST_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'ORDER_NEW',
  'ORDER_CANCELLED',
  'REFUND_REQUEST_NEW',
  'REFUND_REQUEST_APPROVED',
  'REFUND_REQUEST_REJECTED',
  'REFUND_REQUEST_ESCALATED',
  'REFUND_REQUEST_DECIDED_BY_ADMIN',
  'REFUND_COMPLETED',
  'SHOP_STATUS_CHANGED',
  'ADMIN_SHOP_PENDING',
  'ADMIN_APPEAL_PENDING',
  'APPEAL_DECIDED',
  'REPORT_NEW',
]);

// HÀM THUẦN: một thông báo có đáng hiện toast không. Loại lạ (UNKNOWN) không bao giờ — không biết nó nói gì. Đơn bị hủy
// do CHÍNH người nhận làm (người mua tự hủy đơn của mình) là bản ghi lại việc vừa làm, không cần toast.
export function shouldToastNotification(notification: Notification): boolean {
  if (notification.type === 'UNKNOWN') return false;
  if (!TOAST_TYPES.has(notification.type)) return false;
  if (notification.type === 'ORDER_CANCELLED') {
    const { audience, by } = notification.data;
    const isSelfInitiated =
      (audience === 'BUYER' && by === 'BUYER') || (audience === 'SELLER' && by === 'SELLER');
    return !isSelfInitiated;
  }
  return true;
}
