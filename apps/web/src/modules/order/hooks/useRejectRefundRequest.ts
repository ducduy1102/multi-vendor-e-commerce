import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { sellerOrdersQueryKey } from './order-query-keys';

interface RejectRefundRequestVariables {
  requestId: string;
  note: string;
}

// Từ chối yêu cầu: ghi chú BẮT BUỘC (người mua đọc được lý do). Đơn giữ nguyên trạng thái nhưng cờ
// canApprove/canReject của yêu cầu — nằm cả trong chi tiết đơn — đã đổi, nên làm mới CẢ nhánh seller của
// shop, thành công hay thất bại (cùng lý do với useApproveRefundRequest).
export function useRejectRefundRequest(shopId: string) {
  const queryClient = useQueryClient();
  const refreshSellerOrders = () =>
    queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });

  return useMutation({
    mutationFn: ({ requestId, note }: RejectRefundRequestVariables) =>
      orderService.rejectRefundRequest(shopId, requestId, { note }),
    onSuccess: refreshSellerOrders,
    onError: refreshSellerOrders,
  });
}
