import type { OrderStatus, PaymentMethod } from '@ecommerce/types';

import type { AdminDisputeFilter, AdminRefundTab } from './admin-refunds-href';
import type { AdminShopBadgeTone } from './admin-status-display';
import type {
  AbnormalPaymentKind,
  AdminRefundListFilter,
  AdminRefundRequest,
  PaymentRefundStatus,
  RefundRequestKind,
  RefundRequestStatus,
} from './types';

// Cách hiển thị các thực thể của khu hoàn tiền (Week9.md 3.7): key i18n (namespace `admin`) tra theo enum lúc
// chạy nên TypeScript không kiểm được key có bản dịch hay không — admin-refund-display.test.ts là lưới an toàn
// thay thế (mọi giá trị enum đều có nhãn ở vi và en). Chỉ token ngữ nghĩa (rules/frontend.md "UI polish" mục 2):
// `warning` cho việc Admin phải quyết, `destructive` cho khoản hoàn lỗi (cần chú ý), `success` cho kết quả tốt,
// `muted` cho trạng thái trung tính/đang chờ bên khác. Accent (cam) không dùng cho trạng thái.

interface BadgeDisplay {
  labelKey: string;
  tone: AdminShopBadgeTone;
}

// Nhìn từ Admin: yêu cầu đã lên sàn là việc của MÌNH (warning); còn chờ shop thì mình chỉ ghi đè khi cần (muted).
export const ADMIN_REFUND_REQUEST_STATUS_DISPLAY: Record<RefundRequestStatus, BadgeDisplay> = {
  ESCALATED: { labelKey: 'refundsRequestEscalated', tone: 'warning' },
  PENDING_SELLER: { labelKey: 'refundsRequestPendingSeller', tone: 'muted' },
  APPROVED: { labelKey: 'refundsRequestApproved', tone: 'success' },
  REJECTED_BY_SELLER: { labelKey: 'refundsRequestRejectedBySeller', tone: 'muted' },
  REJECTED: { labelKey: 'refundsRequestRejected', tone: 'muted' },
  WITHDRAWN: { labelKey: 'refundsRequestWithdrawn', tone: 'muted' },
};

export const ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS: Record<RefundRequestKind, string> = {
  CANCEL: 'refundsKindCancel',
  RETURN: 'refundsKindReturn',
};

// Khoản hoàn FAILED là thứ Admin phải gỡ (destructive); PENDING là đang chờ cổng (warning — chưa chắc lỗi, nút
// thử lại chỉ bật khi quá 5 phút, do BE quyết); SUCCEEDED là lịch sử.
export const ADMIN_REFUND_STATUS_DISPLAY: Record<PaymentRefundStatus, BadgeDisplay> = {
  FAILED: { labelKey: 'refundsStatusFailed', tone: 'destructive' },
  PENDING: { labelKey: 'refundsStatusPending', tone: 'warning' },
  SUCCEEDED: { labelKey: 'refundsStatusSucceeded', tone: 'success' },
};

// Vì sao một thanh toán bị coi là bất thường — Admin cần đọc được lý do ngay ở dòng, không phải đoán từ danh sách đơn.
export const ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY: Record<
  AbnormalPaymentKind,
  { labelKey: string; hintKey: string; tone: AdminShopBadgeTone }
> = {
  PAID_AFTER_EXPIRY: {
    labelKey: 'refundsPaymentKindPaidAfterExpiry',
    hintKey: 'refundsPaymentKindPaidAfterExpiryHint',
    tone: 'warning',
  },
  DUPLICATE: {
    labelKey: 'refundsPaymentKindDuplicate',
    hintKey: 'refundsPaymentKindDuplicateHint',
    tone: 'warning',
  },
};

export const ADMIN_PAYMENT_METHOD_LABEL_KEYS: Record<PaymentMethod, string> = {
  VNPAY: 'refundsMethodVnpay',
  MOMO: 'refundsMethodMomo',
  COD: 'refundsMethodCod',
};

// Lý do shop từ chối (lần gần nhất) — thứ Admin cần đọc đầu tiên khi quyết một khiếu nại, cạnh lý do của người
// mua. Lấy từ `history` (nguồn sự thật duy nhất, BE không trả cột riêng); chỉ lấy ghi chú do SELLER nhập, bỏ
// ghi chú rỗng và ghi chú của hệ thống/Admin (có thể là chuỗi nội bộ). null khi shop chưa từ chối bằng lý do.
export function getLatestSellerRejectionNote(
  history: AdminRefundRequest['history'],
): string | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.toStatus === 'REJECTED_BY_SELLER' && entry.actorType === 'SELLER' && entry.note) {
      return entry.note;
    }
  }
  return null;
}

export type RefundOutcomeToast = { type: 'success' | 'info' | 'error'; messageKey: string };

// Câu báo sau khi Admin thử lại / hoàn một thanh toán / ghi nhận hoàn tay: các route này trả 200 kể cả khi cổng vẫn
// từ chối (khoản hoàn FAILED) hoặc chưa kịp trả lời (PENDING), nên "gọi API thành công" KHÔNG có nghĩa là tiền đã
// hoàn — nói đúng kết quả của khoản hoàn thay vì luôn báo thành công.
export function getRefundOutcomeToast(status: PaymentRefundStatus): RefundOutcomeToast {
  switch (status) {
    case 'SUCCEEDED':
      return { type: 'success', messageKey: 'refundsOutcomeSucceeded' };
    case 'PENDING':
      return { type: 'info', messageKey: 'refundsOutcomePending' };
    case 'FAILED':
      return { type: 'error', messageKey: 'refundsOutcomeFailed' };
  }
}

// Nhãn trạng thái ĐƠN trong các dòng của khu hoàn tiền: dùng chung bộ nhãn của namespace `order` (nơi trạng thái
// đơn được dịch) — module admin không import module order nên giữ bảng ánh xạ enum → key ở đây; test kiểm phủ đủ
// mọi trạng thái và key có thật ở cả vi lẫn en. Nơi dùng gọi `useTranslations('order')`.
export const ADMIN_ORDER_STATUS_LABEL_KEYS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'statusAwaitingPayment',
  PENDING: 'statusPending',
  CONFIRMED: 'statusConfirmed',
  PACKED: 'statusPacked',
  SHIPPING: 'statusShipping',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
  REFUNDED: 'statusRefunded',
};

// Câu rỗng theo bộ lọc đang xem (nói đúng "không có gì ở bộ lọc NÀY", không phải "không có gì cả").
export const ADMIN_DISPUTE_EMPTY_KEYS: Record<AdminDisputeFilter, string> = {
  ESCALATED: 'refundsEmptyEscalated',
  PENDING_SELLER: 'refundsEmptyPendingSeller',
};

export const ADMIN_LEDGER_EMPTY_KEYS: Record<AdminRefundListFilter, string> = {
  NEEDS_ACTION: 'refundsEmptyNeedsAction',
  PENDING: 'refundsEmptyPending',
  FAILED: 'refundsEmptyFailed',
  SUCCEEDED: 'refundsEmptySucceeded',
};

// Nhãn cho `aria-label` của danh sách (trình đọc màn hình đọc "Danh sách …" thay vì chỉ "danh sách").
export const ADMIN_REFUND_LIST_LABEL_KEYS: Record<AdminRefundTab, string> = {
  disputes: 'refundsListLabelDisputes',
  failed: 'refundsListLabelFailed',
  payments: 'refundsListLabelPayments',
};
