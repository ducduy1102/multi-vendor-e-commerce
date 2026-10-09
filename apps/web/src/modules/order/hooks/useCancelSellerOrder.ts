import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';
import { sellerOrdersQueryKey, sellerRefundRequestListsQueryKey } from './order-query-keys';

interface CancelSellerOrderVariables {
  orderId: string;
  reason: string;
}

// CONFIRMED/PACKED → CANCELLED (khác useRejectOrder: đơn PENDING); lý do bắt buộc. Hủy xong, yêu cầu hủy
// đang chờ của người mua (nếu có) tự đóng nên cả hàng chờ yêu cầu cũng phải làm mới, không chỉ danh sách đơn.
export function useCancelSellerOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, reason }: CancelSellerOrderVariables) =>
      orderService.cancelSellerOrder(shopId, orderId, { reason }),
    onSuccess: (order) => {
      syncSellerOrder(queryClient, shopId, order);
      void queryClient.invalidateQueries({ queryKey: sellerRefundRequestListsQueryKey(shopId) });
    },
    // Lỗi thường là đơn vừa đổi (người mua xin hủy/seller khác thao tác) nên cờ canCancel/canPack/...
    // đang hiển thị đã cũ — làm mới để nút đúng ngay thay vì bắt người bán tự tải lại trang.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });
    },
  });
}
