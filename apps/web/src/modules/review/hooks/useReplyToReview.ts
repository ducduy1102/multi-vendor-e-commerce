import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as reviewService from '../services/review.service';
import { sellerReviewListsQueryKey } from './review-query-keys';

interface ReplyToReviewVariables {
  reviewId: string;
  reply: string;
}

// reviewId truyền lúc mutate (không lúc khai hook) để 1 hook phục vụ form trả lời của mọi đánh giá trong
// danh sách. Thành công hay thất bại đều làm mới MỌI danh sách: thành công thì đánh giá đã đổi tab
// (chưa trả lời → đã trả lời) hoặc đổi nội dung; thất bại (vd 404 đánh giá không còn) thì danh sách đang
// hiển thị đã cũ.
export function useReplyToReview(shopId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: sellerReviewListsQueryKey(shopId) });

  return useMutation({
    mutationFn: ({ reviewId, reply }: ReplyToReviewVariables) =>
      reviewService.replyToReview(shopId, reviewId, { reply }),
    onSuccess: invalidateLists,
    onError: invalidateLists,
  });
}
