import type { SellerReviewListQuery } from '../types';

// Mọi query key của module review khai ở ĐÂY (1 chỗ duy nhất, như order-query-keys). Chỉ phía seller dùng
// TanStack Query: danh sách đánh giá công khai ở trang sản phẩm do Server Component tự gọi service, còn
// người mua viết/sửa đánh giá chỉ là mutation (cache chi tiết đơn thuộc module order, không đụng ở đây).

// Tiền tố của MỌI query đánh giá của 1 shop — `shopId` trong key để 2 shop không dùng chung cache.
export function sellerReviewsQueryKey(shopId: string) {
  return ['reviews', 'seller', shopId] as const;
}

// Tiền tố của MỌI danh sách (mọi bộ lọc/trang) — dùng để invalidate: trả lời xong, đánh giá rời tab
// "chưa trả lời" sang tab "đã trả lời" nên mọi bộ lọc đều cũ.
export function sellerReviewListsQueryKey(shopId: string) {
  return [...sellerReviewsQueryKey(shopId), 'list'] as const;
}

export function sellerReviewListQueryKey(shopId: string, query: Partial<SellerReviewListQuery>) {
  return [...sellerReviewListsQueryKey(shopId), query] as const;
}
