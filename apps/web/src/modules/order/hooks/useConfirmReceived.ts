import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';

// "Đã nhận hàng" (SHIPPING → COMPLETED). Với đơn COD, BE tự thu tiền khi cả nhóm hoàn tất.
export function useConfirmReceived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => orderService.confirmReceived(orderId),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
  });
}
