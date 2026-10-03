import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';
import { sellerOrdersQueryKey } from './order-query-keys';

interface ShipOrderVariables {
  orderId: string;
  carrier?: string;
  trackingCode?: string;
}

// PACKED → SHIPPING, kèm đơn vị vận chuyển/mã vận đơn nhập tay (đều tuỳ chọn).
export function useShipOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, carrier, trackingCode }: ShipOrderVariables) =>
      orderService.shipOrder(shopId, orderId, { carrier, trackingCode }),
    onSuccess: (order) => syncSellerOrder(queryClient, shopId, order),
    // Lỗi thường là đơn vừa đổi (người mua hủy/thua race) nên cờ canConfirm/canPack/... đang hiển thị
    // đã cũ — làm mới để nút đúng ngay thay vì bắt người bán tự tải lại trang.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });
    },
  });
}
