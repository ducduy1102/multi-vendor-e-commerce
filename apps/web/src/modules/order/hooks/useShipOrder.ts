import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';

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
  });
}
