import { useMutation } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import type { PlaceOrderInput } from '../types';

// Không tự invalidate cache 'cart' ở đây — CheckoutContainer (3.4) điều hướng
// sang paymentUrl của cổng ngay sau khi thành công (window.location, full-page
// redirect), giỏ hàng chỉ cần đúng lại khi quay về trang kết quả (3.6).
export function usePlaceOrder() {
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PlaceOrderInput; idempotencyKey?: string }) =>
      checkoutService.placeOrder(input, idempotencyKey),
  });
}
