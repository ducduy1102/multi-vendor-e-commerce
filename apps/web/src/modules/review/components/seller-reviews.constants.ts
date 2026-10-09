// Khung của danh sách đánh giá phía seller — dùng chung giữa danh sách thật (SellerReviewsContainer) và
// SellerReviewsSkeleton để hai bên không lệch viền/đệm khi dữ liệu về (rules/frontend.md mục 10). `grid-cols-1`
// ở mỗi mục (trong ReviewItem / skeleton) giữ cột co được khi có chuỗi dài không dấu cách.
export const SELLER_REVIEWS_CARD_CLASS =
  'flex flex-col rounded-lg border border-border bg-background px-3 py-4 sm:px-4';
