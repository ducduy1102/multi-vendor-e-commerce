// Barrel export cho module review — export những gì app/ và module khác (product, order) cần: component,
// hook, service (Server Component gọi thẳng `reviewService.listProductReviews`), schema form, type. Module
// này không được import product/order/cart/checkout/voucher — product và order import ngược lại barrel này để
// hiện đánh giá, nên cấm chiều kia để đồ thị không có vòng (shared/lib/module-boundaries.test.ts kiểm điều
// này).
export { ProductReviewList } from './components/ProductReviewList';
export { ReviewListSkeleton } from './components/ReviewListSkeleton';
export { buildReviewHref, parseReviewPageQuery, type ReviewPageQuery } from './review-page-query';
export {
  sellerReviewListQueryKey,
  sellerReviewListsQueryKey,
  sellerReviewsQueryKey,
} from './hooks/review-query-keys';
export { useCreateReview, type ReviewWriteOptions } from './hooks/useCreateReview';
export { useDescribeReviewError } from './hooks/useDescribeReviewError';
export { useReplyToReview } from './hooks/useReplyToReview';
export { useSellerReviews } from './hooks/useSellerReviews';
export { useUpdateReview } from './hooks/useUpdateReview';
export {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_REPLY_MAX_LENGTH,
  replyReviewSchema,
  reviewFormSchema,
} from './schemas/review.schema';
export * as reviewService from './services/review.service';
export type {
  CreateReviewInput,
  ListReviewsQuery,
  OrderItemReview,
  ProductReviewsResponse,
  ReplyReviewInput,
  Review,
  ReviewDistribution,
  ReviewFormInput,
  ReviewSummary,
  SellerReview,
  SellerReviewListQuery,
  SellerReviewListResponse,
  UpdateReviewInput,
} from './types';
