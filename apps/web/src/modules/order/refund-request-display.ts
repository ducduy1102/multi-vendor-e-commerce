import type {
  OrderRefundSummary,
  RefundReasonCode,
  RefundRequestKind,
  RefundRequestStatus,
} from './types';
import type { OrderBadgeTone } from './order-status-display';

// Cách hiển thị yêu cầu hủy/trả hàng của người mua (Week9.md 3.5): key i18n (namespace `order`) tra theo enum
// lúc chạy nên TypeScript không kiểm được key có bản dịch hay không — refund-request-display.test.ts là lưới
// an toàn thay thế (mọi mã/trạng thái đều có nhãn ở vi và en).

// Nhãn lý do theo mã (mã là chuỗi kiểm bằng Zod, không phải enum DB — xem refund.ts). `Record<RefundReasonCode, …>`
// bắt TypeScript báo lỗi nếu BE thêm mã mà FE chưa có nhãn.
export const REFUND_REASON_LABEL_KEYS: Record<RefundReasonCode, string> = {
  CHANGE_OF_MIND: 'refundReasonChangeOfMind',
  ORDER_INFO_WRONG: 'refundReasonOrderInfoWrong',
  FOUND_CHEAPER: 'refundReasonFoundCheaper',
  DELIVERY_TOO_SLOW: 'refundReasonDeliveryTooSlow',
  DAMAGED: 'refundReasonDamaged',
  WRONG_ITEM: 'refundReasonWrongItem',
  NOT_AS_DESCRIBED: 'refundReasonNotAsDescribed',
  MISSING_ITEM: 'refundReasonMissingItem',
  OTHER: 'refundReasonOther',
};

// `reasonCode` ở response là chuỗi thường (BE thêm mã mới thì không làm hỏng cả đơn khi parse) nên có thể là
// mã FE chưa biết — rơi về nhãn "Lý do khác" thay vì hiện mã nội bộ thô cho người dùng.
export function getRefundReasonLabelKey(code: string): string {
  // hasOwnProperty chứ không phải `in`: `in` đi lên chuỗi prototype nên "toString"/"constructor" từ BE (hoặc từ
  // URL/dữ liệu lạ) sẽ trả về một HÀM thay vì nhãn.
  return Object.prototype.hasOwnProperty.call(REFUND_REASON_LABEL_KEYS, code)
    ? REFUND_REASON_LABEL_KEYS[code as RefundReasonCode]
    : REFUND_REASON_LABEL_KEYS.OTHER;
}

export const REFUND_REQUEST_TITLE_KEYS: Record<RefundRequestKind, string> = {
  CANCEL: 'refundCardTitleCancel',
  RETURN: 'refundCardTitleReturn',
};

// Hệ quả khi SHOP để quá hạn phản hồi, theo loại yêu cầu — khớp luật của hệ thống ở REFUND_REQUEST_TRANSITIONS:
// hủy trước giao thì tự duyệt (hàng chưa rời shop), trả hàng sau giao thì chuyển lên sàn (không tự duyệt tiền).
// Hiện cạnh hạn để shop biết im lặng thì chuyện gì xảy ra.
export const REFUND_SELLER_OVERDUE_KEYS: Record<RefundRequestKind, string> = {
  CANCEL: 'refundSellerOverdueCancel',
  RETURN: 'refundSellerOverdueReturn',
};

// Tông màu chỉ dùng token ngữ nghĩa, như ORDER_STATUS_DISPLAY: `warning` = người mua có thể/cần làm gì đó
// (bị shop từ chối ⇒ khiếu nại được), `neutral` = đang chờ bên khác, `success` = đã chấp thuận, `muted` = kết
// thúc không có lợi/đã rút. KHÔNG dùng `destructive` — một yêu cầu bị từ chối là kết quả trung tính trong danh sách.
export const REFUND_REQUEST_STATUS_DISPLAY: Record<
  RefundRequestStatus,
  { labelKey: string; tone: OrderBadgeTone }
> = {
  PENDING_SELLER: { labelKey: 'refundStatusPendingSeller', tone: 'neutral' },
  REJECTED_BY_SELLER: { labelKey: 'refundStatusRejectedBySeller', tone: 'warning' },
  ESCALATED: { labelKey: 'refundStatusEscalated', tone: 'neutral' },
  APPROVED: { labelKey: 'refundStatusApproved', tone: 'success' },
  REJECTED: { labelKey: 'refundStatusRejected', tone: 'muted' },
  WITHDRAWN: { labelKey: 'refundStatusWithdrawn', tone: 'muted' },
};

export interface OrderRefundDescription {
  labelKey: string;
  // Số tiền (chuỗi VND từ BE) nếu câu có chỗ cho số tiền; null với câu không nêu số tiền.
  amount: string | null;
}

// Dòng hoàn tiền ở phần thanh toán của chi tiết đơn, từ khoản hoàn của sổ cái (BE chỉ trả trạng thái + số tiền,
// không lộ lý do lỗi nội bộ): đã hoàn / đang hoàn / gặp sự cố. Khoản FAILED không hứa thời hạn — shop hoặc sàn
// đang xử lý (Admin thử lại hoặc ghi nhận hoàn tay).
export function describeOrderRefund(refund: OrderRefundSummary): OrderRefundDescription {
  switch (refund.status) {
    case 'SUCCEEDED':
      return { labelKey: 'refundSucceeded', amount: refund.amount };
    case 'PENDING':
      return { labelKey: 'refundPending', amount: refund.amount };
    case 'FAILED':
      return { labelKey: 'refundFailed', amount: null };
  }
}
