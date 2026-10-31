import { useMutation } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { UnhideReviewInput } from '../types';

interface UnhideReviewVariables extends UnhideReviewInput {
  reviewId: string;
}

// Mở lại đánh giá đã ẩn (sửa nhầm). Không có truy vấn nào của khu Admin hiển thị trạng thái ẩn của đánh giá nên không cần làm mới cache:
// nơi gọi tự ghi nhớ "đã mở lại" trong lần hiển thị này (đánh giá hiện lại ở trang sản phẩm công khai, nơi dữ liệu luôn tải mới).
export function useUnhideReview() {
  return useMutation({
    mutationFn: ({ reviewId, ...input }: UnhideReviewVariables) =>
      adminService.unhideReview(reviewId, input),
  });
}
