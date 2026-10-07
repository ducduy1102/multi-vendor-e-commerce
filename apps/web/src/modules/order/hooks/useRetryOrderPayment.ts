import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { buyerOrdersQueryKey } from './order-query-keys';

// Trả về { paymentUrl, expiresAt } — component tự chuyển trình duyệt sang cổng thanh toán, nên
// thành công không cập nhật cache (rời trang). Lỗi (hết hạn giữ chỗ, nhóm vừa bị hủy...) nghĩa là
// cờ canRetryPayment đang hiển thị đã cũ — ở CẢ danh sách lẫn trang chi tiết — ⇒ làm mới toàn bộ
// nhánh buyer để nút biến mất đúng ở nơi đang xem.
export function useRetryOrderPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (groupId: string) => orderService.retryPayment(groupId),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
