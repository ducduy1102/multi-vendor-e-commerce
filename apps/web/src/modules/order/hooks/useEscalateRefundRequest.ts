import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';
import { buyerOrdersQueryKey } from './order-query-keys';

interface EscalateRefundRequestVariables {
  requestId: string;
}

// Khiếu nại lên sàn sau khi seller từ chối — một lần duy nhất, trong hạn (cờ canEscalate do BE tính).
// requestId truyền lúc mutate. BE trả chi tiết đơn mới nhất (`refundRequest.status` = ESCALATED). 409
// REFUND_REQUEST_NOT_ALLOWED (details.reason = WINDOW_EXPIRED) = quá hạn khiếu nại.
export function useEscalateRefundRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId }: EscalateRefundRequestVariables) =>
      orderService.escalateRefundRequest(requestId),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
    // Quá hạn/đã khiếu nại rồi ⇒ nút "Khiếu nại với sàn" đang hiển thị đã cũ — làm mới để nút biến mất.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
