import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { syncBuyerOrder } from './order-cache';
import { buyerOrdersQueryKey } from './order-query-keys';

// "Đã nhận hàng" (SHIPPING → COMPLETED). Với đơn COD, BE tự thu tiền khi cả nhóm hoàn tất.
export function useConfirmReceived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => orderService.confirmReceived(orderId),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
    // Lỗi thường là đơn vừa đổi ở nơi khác (job tự hoàn tất vừa chạy, bấm từ tab khác) nên cờ
    // canConfirmReceived đang hiển thị đã cũ — làm mới để nút biến mất đúng.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
