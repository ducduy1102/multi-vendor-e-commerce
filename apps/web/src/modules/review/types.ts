// Type request/response cho module review (người mua viết/sửa, đọc công khai, seller xem/trả lời), dùng
// chung qua @ecommerce/types — không định nghĩa lại (rules/general.md mục 4).
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
} from '@ecommerce/types';
