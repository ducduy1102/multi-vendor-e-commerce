import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';
import { buyerOrdersQueryKey } from './order-query-keys';

interface WithdrawRefundRequestVariables {
  requestId: string;
}

// Rút yêu cầu khi seller chưa trả lời. requestId truyền lúc mutate để 1 hook phục vụ mọi card. BE trả chi
// tiết đơn mới nhất (`refundRequest` là null) nên ghi thẳng vào cache chi tiết. 409
// REFUND_REQUEST_INVALID_TRANSITION = seller vừa trả lời giữa chừng.
export function useWithdrawRefundRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId }: WithdrawRefundRequestVariables) =>
      orderService.withdrawRefundRequest(requestId),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
    // Seller vừa duyệt/từ chối ⇒ nút "Rút yêu cầu" đang hiển thị đã cũ — làm mới để thẻ trạng thái đúng.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
