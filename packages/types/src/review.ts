import { z } from 'zod';
import { optionalText } from './optional-text';

// Đánh giá sản phẩm (Week9.md 1.8). Rating nguyên 1-5, comment và lời trả lời của seller tối đa 1000 ký
// tự — cùng giới hạn với CHECK ở DB (reviews_rating_check, reviews_comment_length_check) và cột
// seller_reply VARCHAR(1000), nên đổi ở đây phải đổi cả migration.
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_COMMENT_MAX_LENGTH = 1000;
export const REVIEW_REPLY_MAX_LENGTH = 1000;

// Thiếu rating (người dùng chưa bấm sao) và rating sai (không nguyên/ngoài 1-5) là 2 thông điệp khác nhau.
export const reviewRatingSchema = z
  .number({
    required_error: 'review.validationRatingRequired',
    invalid_type_error: 'review.validationRatingRequired',
  })
  .int('review.validationRatingInvalid')
  .min(REVIEW_RATING_MIN, 'review.validationRatingInvalid')
  .max(REVIEW_RATING_MAX, 'review.validationRatingInvalid');

// POST /reviews — viết đánh giá cho 1 sản phẩm trong 1 đơn đã COMPLETED. orderId/productId không phải
// ô người dùng nhập (FE lấy từ dòng hàng) nên không có thông điệp i18n riêng; điều kiện nghiệp vụ (đơn của
// đúng người mua, đã hoàn tất, chứa sản phẩm, còn trong cửa sổ, chưa đánh giá) do BE kiểm.
export const createReviewSchema = z.object({
  orderId: z.string().min(1),
  productId: z.string().min(1),
  rating: reviewRatingSchema,
  comment: optionalText(REVIEW_COMMENT_MAX_LENGTH, 'review.validationCommentTooLong'),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

// Phần người dùng thực sự điền ở form (không có orderId/productId). Dùng chung cho form viết mới lẫn
// sửa; PATCH /reviews/:id gửi lại ĐỦ rating + comment (sửa được đúng một lần, form điền sẵn giá trị cũ).
export const reviewFormSchema = createReviewSchema.pick({ rating: true, comment: true });
export type ReviewFormInput = z.infer<typeof reviewFormSchema>;

export const updateReviewSchema = reviewFormSchema;
export type UpdateReviewInput = ReviewFormInput;

// PUT /shops/:shopId/reviews/:reviewId/reply — seller trả lời một lần (sửa lại được, không xoá).
export const replyReviewSchema = z.object({
  reply: z
    .string({ required_error: 'review.validationReplyRequired' })
    .trim()
    .min(1, 'review.validationReplyRequired')
    .max(REVIEW_REPLY_MAX_LENGTH, 'review.validationReplyTooLong'),
});
export type ReplyReviewInput = z.infer<typeof replyReviewSchema>;

// Query param qua URL luôn là string — coerce number (rules/backend.md mục 2).
const paginationShape = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
};

// GET /products/:idOrSlug/reviews — lọc theo số sao (tuỳ chọn), mới nhất trước.
export const listReviewsQuerySchema = z.object({
  rating: z.coerce.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX).optional(),
  ...paginationShape,
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

// --- Response công khai ----------------------------------------------------------------------------

// Tên người đánh giá đã bị che ở BE (chữ cái đầu + ***); KHÔNG bao giờ trả userId/email.
export const reviewSchema = z.object({
  id: z.string(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  // Có giá trị = người mua đã sửa (chỉ sửa được một lần).
  editedAt: z.string().nullable(),
  reviewerName: z.string(),
  sellerReply: z.string().nullable(),
  sellerRepliedAt: z.string().nullable(),
});
export type Review = z.infer<typeof reviewSchema>;

// Số đánh giá theo từng mức sao. Khai đủ 5 khoá cố định (JSON object khoá chuỗi '1'..'5') thay vì
// z.record để kiểu suy ra không bị Partial — BE luôn trả đủ 5 khoá, mức không có đánh giá là 0.
const countSchema = z.number().int().nonnegative();
export const reviewDistributionSchema = z.object({
  '1': countSchema,
  '2': countSchema,
  '3': countSchema,
  '4': countSchema,
  '5': countSchema,
});
export type ReviewDistribution = z.infer<typeof reviewDistributionSchema>;

// avgRating/reviewCount khớp cột denormalized Product.avgRating/reviewCount (làm tròn 2 chữ số); 0/0 khi
// chưa có đánh giá nào.
export const reviewSummarySchema = z.object({
  avgRating: z.number().min(0).max(REVIEW_RATING_MAX),
  reviewCount: countSchema,
  distribution: reviewDistributionSchema,
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const productReviewsResponseSchema = z.object({
  summary: reviewSummarySchema,
  items: z.array(reviewSchema),
  total: countSchema,
  page: z.number().int(),
  limit: z.number().int(),
});
export type ProductReviewsResponse = z.infer<typeof productReviewsResponseSchema>;
