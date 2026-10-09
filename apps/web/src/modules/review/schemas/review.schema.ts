// Dùng thẳng schema BE — form viết/sửa đánh giá chỉ có rating + comment (`reviewFormSchema`, bản `pick` của
// `createReviewSchema` nên không lệch giới hạn với BE), form trả lời của seller chỉ có `reply`. Message lỗi
// là key i18n `review.validation*`, dịch khi hiển thị. `comment` bỏ trống (`""` từ input) được schema coi
// là chưa nhập (transform ở cuối chain, tương thích zodResolver — rules/frontend.md mục 4).
export {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_REPLY_MAX_LENGTH,
  replyReviewSchema,
  reviewFormSchema,
} from '@ecommerce/types';
