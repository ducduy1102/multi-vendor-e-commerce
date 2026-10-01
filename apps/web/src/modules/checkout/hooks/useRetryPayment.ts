import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import { checkoutGroupQueryKey } from './useCheckoutGroup';

// Tiếp tục thanh toán / thanh toán lại từ trang /checkout/result (3.6) — sau
// khi có payUrl mới, trang điều hướng sang cổng (window.location); làm mới
// cache nhóm để lần quay lại (nếu có) thấy đúng expiresAt/canRetry mới nhất.
export function useRetryPayment(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => checkoutService.retryPayment(groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: checkoutGroupQueryKey(groupId) });
    },
  });
}
