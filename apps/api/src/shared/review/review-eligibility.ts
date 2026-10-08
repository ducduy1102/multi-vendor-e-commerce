import type { OrderStatus } from '@prisma/client';
import { readPositiveInt } from '../utils/read-positive-int';

// Luật "ai được đánh giá sản phẩm nào" (Week9.md 1.8) — HÀM THUẦN dùng chung cho hai phía: module `review`
// (chặn khi viết) và module `order` (tính cờ `canReview` ở chi tiết đơn của người mua). Hai module không được
// import nhau (module-boundaries.spec.ts) nên luật nằm ở `shared/`; nếu mỗi bên tự viết một bản thì nút hiện
// ra mà bấm vào bị từ chối (hoặc ngược lại) khi đổi chính sách.

// Số ngày kể từ lúc đơn COMPLETED mà người mua còn viết được đánh giá. Đọc ENV LÚC DÙNG (không lúc boot,
// rules/backend.md mục 8); biến không khai/để trống/không phải số nguyên dương ⇒ về mặc định.
const DEFAULT_REVIEW_WINDOW_DAYS = 90;

export function readReviewWindowDays(): number {
  return readPositiveInt('REVIEW_WINDOW_DAYS', DEFAULT_REVIEW_WINDOW_DAYS);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Mốc hạn chót vẫn là CÒN trong cửa sổ (bao gồm cả đúng thời điểm hết hạn) — cùng quy ước isWithinRefundWindow.
export function isWithinReviewWindow(
  completedAt: Date,
  now: Date,
  windowDays: number,
): boolean {
  return now.getTime() <= completedAt.getTime() + windowDays * DAY_MS;
}

// Khớp `details.reason` của mã lỗi REVIEW_NOT_ALLOWED (packages/types/src/error-code.ts).
export type ReviewBlockReason =
  | 'NOT_PURCHASED'
  | 'ORDER_NOT_COMPLETED'
  | 'WINDOW_EXPIRED'
  | 'ALREADY_REVIEWED';

export interface ReviewEligibilityInput {
  // Đơn có chứa sản phẩm đó không (qua OrderItem.productVariantId → ProductVariant.productId).
  containsProduct: boolean;
  orderStatus: OrderStatus;
  // Lúc đơn COMPLETED gần nhất (từ OrderStatusHistory); null = không có dấu vết.
  completedAt: Date | null;
  now: Date;
  windowDays: number;
  // Người mua đã đánh giá sản phẩm này trong đơn này (unique [userId, productId, orderId]).
  alreadyReviewed: boolean;
}

// Lý do KHÔNG đánh giá được, hoặc null = được. Thứ tự kiểm đi từ điều kiện "nền" tới điều kiện "thời điểm":
// sản phẩm không thuộc đơn thì trạng thái đơn không còn ý nghĩa; chỉ đơn COMPLETED mới đánh giá (REFUNDED sau
// khi trả hàng thì không); không rõ lúc hoàn tất ⇒ coi như hết hạn (từ chối an toàn); đã đánh giá thì báo
// cuối cùng để người dùng thấy lý do cơ bản trước.
export function getReviewBlockReason(
  input: ReviewEligibilityInput,
): ReviewBlockReason | null {
  if (!input.containsProduct) return 'NOT_PURCHASED';
  if (input.orderStatus !== 'COMPLETED') return 'ORDER_NOT_COMPLETED';
  if (
    !input.completedAt ||
    !isWithinReviewWindow(input.completedAt, input.now, input.windowDays)
  ) {
    return 'WINDOW_EXPIRED';
  }
  if (input.alreadyReviewed) return 'ALREADY_REVIEWED';
  return null;
}
