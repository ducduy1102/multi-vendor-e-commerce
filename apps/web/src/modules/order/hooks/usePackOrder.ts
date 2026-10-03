import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';
import { sellerOrdersQueryKey } from './order-query-keys';

// CONFIRMED → PACKED.
export function usePackOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => orderService.packOrder(shopId, orderId),
    onSuccess: (order) => syncSellerOrder(queryClient, shopId, order),
    // Lỗi thường là đơn vừa đổi (người mua hủy/thua race) nên cờ canConfirm/canPack/... đang hiển thị
    // đã cũ — làm mới để nút đúng ngay thay vì bắt người bán tự tải lại trang.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });
    },
  });
}
