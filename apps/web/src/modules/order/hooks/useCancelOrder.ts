import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';
import { buyerOrdersQueryKey } from './order-query-keys';

interface CancelOrderVariables {
  orderId: string;
  reason?: string;
}

// orderId truyền lúc mutate (không lúc khai hook) để 1 hook phục vụ nút hủy của mọi card trong
// danh sách. Đơn chưa thanh toán ⇒ BE hủy cả nhóm; lỗi 409 (đã trả online/đã xác nhận/thua race)
// để component dịch theo `code` qua useApiErrorMessage.
export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, reason }: CancelOrderVariables) =>
      orderService.cancelOrder(orderId, { reason }),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
    // Lỗi thường là đơn vừa đổi ở nơi khác (shop xác nhận đúng lúc người mua bấm hủy ⇒ 409) nên
    // cờ canCancel đang hiển thị đã cũ — làm mới cả danh sách lẫn chi tiết để nút biến mất đúng,
    // thay vì để người mua bấm lại và nhận lại đúng lỗi đó cho tới khi tự tải trang.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
