import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';

// PENDING → CONFIRMED.
export function useConfirmOrder(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => orderService.confirmOrder(shopId, orderId),
    onSuccess: (order) => syncSellerOrder(queryClient, shopId, order),
  });
}
