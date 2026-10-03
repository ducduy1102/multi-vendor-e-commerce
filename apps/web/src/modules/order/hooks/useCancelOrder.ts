import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';

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
  });
}
