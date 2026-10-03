import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';
import { sellerOrdersQueryKey } from './order-query-keys';

interface RejectOrderVariables {
  orderId: string;
  reason: string;
}

// PENDING → CANCELLED, chỉ đơn COD; lý do bắt buộc.
export function useRejectOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, reason }: RejectOrderVariables) =>
      orderService.rejectOrder(shopId, orderId, { reason }),
    onSuccess: (order) => syncSellerOrder(queryClient, shopId, order),
    // Lỗi thường là đơn vừa đổi (người mua hủy/thua race) nên cờ canConfirm/canPack/... đang hiển thị
    // đã cũ — làm mới để nút đúng ngay thay vì bắt người bán tự tải lại trang.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });
    },
  });
}
