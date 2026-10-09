import { useMutation } from '@tanstack/react-query';

import * as reviewService from '../services/review.service';
import type { CreateReviewInput } from '../types';

export interface ReviewWriteOptions {
  // Chạy khi mutation kết thúc, THÀNH CÔNG HAY LỖI. Nơi dùng hook (vd chi tiết đơn của module order) tự
  // làm mới cache của nó trong callback này — cờ `canReview`/`review` nằm trong chi tiết đơn, module review
  // không được import module order để biết key đó (module-boundaries.test.ts). Lỗi cũng cần làm mới vì
  // 409 nghĩa là cờ đang hiển thị đã cũ (đã đánh giá ở tab khác, đơn vừa đổi trạng thái, hết cửa sổ).
  // Trả về Promise (vd kết quả của `invalidateQueries`) thì mutation ĐỢI nó xong mới kết thúc: nơi dùng đóng
  // form sau `mutateAsync` sẽ thấy dữ liệu đã làm mới, không có khoảng nút cũ còn hiện.
  onSettled?: () => unknown;
}

// Người mua viết đánh giá cho 1 dòng hàng của đơn COMPLETED. Không có cache nào của riêng module review
// cần làm mới ở phía người mua: đánh giá công khai ở trang sản phẩm do Server Component đọc lại mỗi lần
// vào trang (route động), còn danh sách của seller thuộc phiên khác.
export function useCreateReview({ onSettled }: ReviewWriteOptions = {}) {
  return useMutation({
    mutationFn: (input: CreateReviewInput) => reviewService.createReview(input),
    onSettled: () => onSettled?.(),
  });
}
