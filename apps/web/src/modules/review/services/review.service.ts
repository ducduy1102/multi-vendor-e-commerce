import {
  productReviewsResponseSchema,
  reviewSchema,
  sellerReviewListResponseSchema,
  sellerReviewSchema,
  type CreateReviewInput,
  type ListReviewsQuery,
  type ProductReviewsResponse,
  type ReplyReviewInput,
  type Review,
  type SellerReview,
  type SellerReviewListQuery,
  type SellerReviewListResponse,
  type UpdateReviewInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (page=1, limit=10, xem
// listReviewsQuerySchema), không lặp lại default ở FE (1 nguồn duy nhất, rules/general.md mục 4).
function toQueryString(params: Partial<ListReviewsQuery | SellerReviewListQuery>): string {
  const searchParams = new URLSearchParams();
  if ('replied' in params && params.replied !== undefined) {
    searchParams.set('replied', params.replied);
  }
  if (params.rating !== undefined) searchParams.set('rating', String(params.rating));
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// --- Đọc công khai -------------------------------------------------------------------------------
// Dùng được cả ở Server Component (trang chi tiết sản phẩm gọi thẳng, không qua TanStack Query) lẫn client.
// Sản phẩm chưa công khai (DRAFT/ARCHIVED, shop chưa duyệt) ⇒ BE trả 404 giống như trang chi tiết.

export async function listProductReviews(
  idOrSlug: string,
  params: Partial<ListReviewsQuery> = {},
): Promise<ProductReviewsResponse> {
  const data = await apiFetch<unknown>(
    `/products/${encodeURIComponent(idOrSlug)}/reviews${toQueryString(params)}`,
    { method: 'GET' },
  );
  return productReviewsResponseSchema.parse(data);
}

// --- Người mua -----------------------------------------------------------------------------------
// Đủ điều kiện đánh giá (đơn COMPLETED, trong cửa sổ, chưa đánh giá) do BE kiểm và tính sẵn thành cờ
// `canReview` ở chi tiết đơn — FE không tự suy luật. orderId/productId lấy từ dòng hàng của đơn.

export async function createReview(input: CreateReviewInput): Promise<Review> {
  const data = await apiFetch<unknown>('/reviews', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return reviewSchema.parse(data);
}

// Sửa được đúng một lần (BE trả 409 REVIEW_EDIT_NOT_ALLOWED lần hai). Gửi lại ĐỦ rating + comment.
export async function updateReview(reviewId: string, input: UpdateReviewInput): Promise<Review> {
  const data = await apiFetch<unknown>(`/reviews/${reviewId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return reviewSchema.parse(data);
}

// --- Seller --------------------------------------------------------------------------------------
// shopId nằm trên URL để BE (ShopOwnerGuard) kiểm quyền sở hữu. Seller xem đánh giá của MỌI sản phẩm của
// shop mình, kể cả sản phẩm đã lưu trữ.

export async function listShopReviews(
  shopId: string,
  params: Partial<SellerReviewListQuery> = {},
): Promise<SellerReviewListResponse> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/reviews${toQueryString(params)}`, {
    method: 'GET',
  });
  return sellerReviewListResponseSchema.parse(data);
}

// Trả lời một lần, gọi lại = sửa câu trả lời (ghi đè), không xoá được.
export async function replyToReview(
  shopId: string,
  reviewId: string,
  input: ReplyReviewInput,
): Promise<SellerReview> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/reviews/${reviewId}/reply`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return sellerReviewSchema.parse(data);
}
