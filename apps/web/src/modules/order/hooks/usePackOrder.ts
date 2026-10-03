import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';

// CONFIRMED → PACKED.
export function usePackOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => orderService.packOrder(shopId, orderId),
    onSuccess: (order) => syncSellerOrder(queryClient, shopId, order),
  });
}
