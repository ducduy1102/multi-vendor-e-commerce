import type { OrderHistoryEntry } from './types';

export interface TimelineStepDescription {
  // Key i18n (namespace `order`) của dòng mô tả bước.
  labelKey: string;
  // Có hiện `note` của bản ghi dưới dòng mô tả không.
  showNote: boolean;
  // Key i18n của câu bọc quanh `note` ("Lý do của shop: …" / "Lý do của người mua: …" / "Lý do của bạn: …").
  // Chỉ có nghĩa khi `showNote`.
  noteKey: string;
}

// Ai đang đọc lịch sử. Hầu hết nhãn viết ở ngôi thứ ba ("Shop đã xác nhận…", "Đã nhận hàng…") nên
// đúng cho cả hai; chỉ khi người MUA hủy thì nhãn phụ thuộc người đọc ("Bạn đã hủy" với người mua,
// "Người mua đã hủy" với shop).
export type TimelineViewer = 'buyer' | 'seller';

// Dòng mô tả của 1 bản ghi lịch sử, dựa trên CẶP trạng thái + người thực hiện — cùng 1 trạng thái
// đích có thể là 2 sự kiện khác nhau với người mua (PENDING từ COD = "đã đặt hàng", PENDING sau
// thanh toán = "đã thanh toán"; CANCELLED do mình hủy / do shop từ chối / do hết hạn thanh toán).
export function describeTimelineEntry(
  entry: OrderHistoryEntry,
  viewer: TimelineViewer = 'buyer',
): TimelineStepDescription {
  const { fromStatus, toStatus, actorType } = entry;

  // Chỉ hiện `note` khi đơn bị HỦY bởi 1 NGƯỜI (shop từ chối hoặc người mua hủy) — lý do đó do chính
  // người đó nhập, hữu ích cho bên kia (shop biết vì sao khách hủy, khách đọc lại lý do của shop).
  // KHÔNG hiện note của bản ghi khác — `note` còn chứa chuỗi hệ thống tiếng Anh do BE tự ghi (vd
  // 'Payment hold reclaimed', 'Payment confirmed', 'Received by buyer', 'backfill') chứ không phải nội
  // dung dành cho người dùng. Người mua hủy không nhập lý do thì BE ghi null (không còn chuỗi mặc định).
  const showNote =
    toStatus === 'CANCELLED' &&
    (actorType === 'SELLER' || actorType === 'BUYER') &&
    Boolean(entry.note);
  const noteKey = noteLabelKey(actorType, viewer);

  if (fromStatus === null && toStatus === 'AWAITING_PAYMENT') {
    return { labelKey: 'timelineCreatedAwaitingPayment', showNote, noteKey };
  }
  if (fromStatus === null && toStatus === 'PENDING') {
    return { labelKey: 'timelineCreatedPending', showNote, noteKey };
  }
  if (fromStatus === 'AWAITING_PAYMENT' && toStatus === 'PENDING') {
    return { labelKey: 'timelinePaid', showNote, noteKey };
  }

  switch (toStatus) {
    case 'AWAITING_PAYMENT':
      return { labelKey: 'timelineAwaitingPayment', showNote, noteKey };
    case 'PENDING':
      return { labelKey: 'timelinePending', showNote, noteKey };
    case 'CONFIRMED':
      return { labelKey: 'timelineConfirmed', showNote, noteKey };
    case 'PACKED':
      return { labelKey: 'timelinePacked', showNote, noteKey };
    case 'SHIPPING':
      return { labelKey: 'timelineShipping', showNote, noteKey };
    case 'COMPLETED':
      return {
        labelKey: actorType === 'SYSTEM' ? 'timelineCompletedAuto' : 'timelineCompleted',
        showNote,
        noteKey,
      };
    case 'CANCELLED':
      return { labelKey: cancelledLabelKey(actorType, viewer), showNote, noteKey };
    case 'REFUNDED':
      return { labelKey: 'timelineRefunded', showNote, noteKey };
  }
}

// Câu bọc `note` theo NGƯỜI VIẾT lý do và NGƯỜI ĐỌC: lý do của shop; lý do của người mua (shop đọc) hoặc
// "của bạn" (chính người mua đọc lại).
function noteLabelKey(actorType: OrderHistoryEntry['actorType'], viewer: TimelineViewer): string {
  if (actorType === 'BUYER') {
    return viewer === 'seller' ? 'timelineBuyerReason' : 'timelineYourReason';
  }
  return 'timelineReason';
}

function cancelledLabelKey(
  actorType: OrderHistoryEntry['actorType'],
  viewer: TimelineViewer,
): string {
  switch (actorType) {
    case 'BUYER':
      return viewer === 'seller' ? 'timelineBuyerCancelled' : 'timelineCancelledByBuyer';
    case 'SELLER':
      return 'timelineCancelledBySeller';
    case 'SYSTEM':
      return 'timelineCancelledBySystem';
    case 'ADMIN':
      return 'timelineCancelled';
  }
}

// Mới nhất lên đầu (như trang theo dõi đơn của các sàn): người đọc quan tâm trạng thái hiện tại
// trước. BE trả cũ → mới (dòng đầu fromStatus = null); không sửa mảng gốc.
export function sortTimelineNewestFirst(
  history: readonly OrderHistoryEntry[],
): OrderHistoryEntry[] {
  return [...history].reverse();
}
