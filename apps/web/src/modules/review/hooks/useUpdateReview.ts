import { useMutation } from '@tanstack/react-query';

import * as reviewService from '../services/review.service';
import type { UpdateReviewInput } from '../types';
import type { ReviewWriteOptions } from './useCreateReview';

interface UpdateReviewVariables extends UpdateReviewInput {
  reviewId: string;
}

// reviewId truyền lúc mutate (không lúc khai hook), tách khỏi body: service nhận (reviewId, {rating,
// comment}). Sửa được đúng một lần — lần hai BE trả 409 REVIEW_EDIT_NOT_ALLOWED, `onSettled` để nơi dùng
// làm mới cờ `canEdit` đang hiển thị.
export function useUpdateReview({ onSettled }: ReviewWriteOptions = {}) {
  return useMutation({
    mutationFn: ({ reviewId, ...input }: UpdateReviewVariables) =>
      reviewService.updateReview(reviewId, input),
    onSettled: () => onSettled?.(),
  });
}
