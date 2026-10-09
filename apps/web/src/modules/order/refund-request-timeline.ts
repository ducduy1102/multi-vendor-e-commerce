import type { RefundRequestHistoryItem } from './types';

// Cùng một bản ghi được kể theo hai góc nhìn: người mua đọc "Bạn đã gửi yêu cầu / Shop đã từ chối", còn shop
// đọc "Người mua đã gửi yêu cầu / Bạn đã từ chối" — dùng nhầm câu của bên kia là sai nghĩa, không chỉ sai giọng.
export type RefundTimelineViewer = 'buyer' | 'seller';

export interface RefundTimelineStepDescription {
  // Key i18n (namespace `order`) của dòng mô tả bước.
  labelKey: string;
  // Có hiện `note` của bản ghi dưới dòng mô tả không.
  showNote: boolean;
  // Key i18n của câu bọc quanh `note` ("Lý do của shop: …" / "Lý do của sàn: …"). Chỉ có nghĩa khi `showNote`.
  noteKey: string;
}

// Dòng mô tả của 1 bản ghi lịch sử yêu cầu, dựa trên CẶP (trạng thái đích, người thực hiện) — dựng từ chính
// `history` (RefundRequestHistory, nguồn sự thật duy nhất), KHÔNG suy ngược từ cột nào của yêu cầu. Cùng một
// trạng thái đích là các sự kiện khác nhau tuỳ người làm: được chấp thuận bởi shop / sàn / hệ thống (quá hạn
// shop không phản hồi), chuyển lên sàn do người mua khiếu nại hay do hệ thống.
export function describeRefundRequestEntry(
  entry: RefundRequestHistoryItem,
  viewer: RefundTimelineViewer = 'buyer',
): RefundTimelineStepDescription {
  // Chỉ hiện `note` do shop hoặc sàn nhập (lý do từ chối/ghi chú duyệt — bên kia cần đọc). Bản ghi của người mua
  // không có note (lý do của họ nằm ở chính yêu cầu) và bản ghi HỆ THỐNG có thể mang chuỗi tiếng Anh nội bộ.
  const showNote =
    (entry.actorType === 'SELLER' || entry.actorType === 'ADMIN') && Boolean(entry.note);

  return {
    labelKey: viewer === 'seller' ? sellerLabelKeyOf(entry) : buyerLabelKeyOf(entry),
    showNote,
    noteKey: noteKeyOf(entry, viewer),
  };
}

// Ghi chú của chính shop: người mua đọc là "Lý do của shop", còn shop tự đọc lại là "Lý do của bạn".
function noteKeyOf({ actorType }: RefundRequestHistoryItem, viewer: RefundTimelineViewer): string {
  if (actorType === 'ADMIN') return 'refundNoteAdmin';
  return viewer === 'seller' ? 'refundNoteSeller' : 'timelineReason';
}

function buyerLabelKeyOf({ toStatus, actorType }: RefundRequestHistoryItem): string {
  switch (toStatus) {
    case 'PENDING_SELLER':
      return 'refundTimelineCreated';
    case 'APPROVED':
      if (actorType === 'ADMIN') return 'refundTimelineApprovedByAdmin';
      if (actorType === 'SYSTEM') return 'refundTimelineApprovedBySystem';
      return 'refundTimelineApprovedBySeller';
    case 'REJECTED_BY_SELLER':
      return 'refundTimelineRejectedBySeller';
    case 'ESCALATED':
      return actorType === 'SYSTEM'
        ? 'refundTimelineEscalatedBySystem'
        : 'refundTimelineEscalatedByBuyer';
    case 'REJECTED':
      return 'refundTimelineRejectedByAdmin';
    case 'WITHDRAWN':
      return 'refundTimelineWithdrawn';
  }
}

// Câu của sàn ("Sàn đã chấp thuận/từ chối") đúng với cả hai bên nên dùng lại key chung, chỉ viết riêng những
// câu có chủ ngữ là người mua hoặc shop.
function sellerLabelKeyOf({ toStatus, actorType }: RefundRequestHistoryItem): string {
  switch (toStatus) {
    case 'PENDING_SELLER':
      return 'refundSellerTimelineCreated';
    case 'APPROVED':
      if (actorType === 'ADMIN') return 'refundTimelineApprovedByAdmin';
      if (actorType === 'SYSTEM') return 'refundSellerTimelineApprovedBySystem';
      return 'refundSellerTimelineApprovedBySeller';
    case 'REJECTED_BY_SELLER':
      return 'refundSellerTimelineRejectedBySeller';
    case 'ESCALATED':
      return actorType === 'SYSTEM'
        ? 'refundSellerTimelineEscalatedBySystem'
        : 'refundSellerTimelineEscalatedByBuyer';
    case 'REJECTED':
      return 'refundTimelineRejectedByAdmin';
    case 'WITHDRAWN':
      return 'refundSellerTimelineWithdrawn';
  }
}

// Mới nhất lên đầu như timeline của đơn hàng. BE trả cũ → mới; không sửa mảng gốc.
export function sortRefundHistoryNewestFirst(
  history: readonly RefundRequestHistoryItem[],
): RefundRequestHistoryItem[] {
  return [...history].reverse();
}
