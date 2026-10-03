import type { OrderHistoryEntry } from './types';

export interface TimelineStepDescription {
  // Key i18n (namespace `order`) của dòng mô tả bước.
  labelKey: string;
  // Có hiện `note` của bản ghi dưới dòng mô tả không.
  showNote: boolean;
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

  // Chỉ hiện `note` khi SHOP từ chối đơn: lý do đó bắt buộc và do shop tự nhập, hữu ích cho người
  // mua. KHÔNG hiện note của bản ghi khác — `note` còn chứa chuỗi hệ thống tiếng Anh do BE tự
  // ghi (vd 'Cancelled by buyer' khi người mua hủy không nhập lý do, 'Payment hold reclaimed',
  // 'Payment confirmed', 'backfill') chứ không phải nội dung dành cho người dùng.
  const showNote = toStatus === 'CANCELLED' && actorType === 'SELLER' && Boolean(entry.note);

  if (fromStatus === null && toStatus === 'AWAITING_PAYMENT') {
    return { labelKey: 'timelineCreatedAwaitingPayment', showNote };
  }
  if (fromStatus === null && toStatus === 'PENDING') {
    return { labelKey: 'timelineCreatedPending', showNote };
  }
  if (fromStatus === 'AWAITING_PAYMENT' && toStatus === 'PENDING') {
    return { labelKey: 'timelinePaid', showNote };
  }

  switch (toStatus) {
    case 'AWAITING_PAYMENT':
      return { labelKey: 'timelineAwaitingPayment', showNote };
    case 'PENDING':
      return { labelKey: 'timelinePending', showNote };
    case 'CONFIRMED':
      return { labelKey: 'timelineConfirmed', showNote };
    case 'PACKED':
      return { labelKey: 'timelinePacked', showNote };
    case 'SHIPPING':
      return { labelKey: 'timelineShipping', showNote };
    case 'COMPLETED':
      return {
        labelKey: actorType === 'SYSTEM' ? 'timelineCompletedAuto' : 'timelineCompleted',
        showNote,
      };
    case 'CANCELLED':
      return { labelKey: cancelledLabelKey(actorType, viewer), showNote };
    case 'REFUNDED':
      return { labelKey: 'timelineRefunded', showNote };
  }
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
