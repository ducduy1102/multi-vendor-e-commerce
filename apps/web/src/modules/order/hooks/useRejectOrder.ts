import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncSellerOrder } from './order-cache';

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
  });
}
