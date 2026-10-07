import { useMutation } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import type { PlaceOrderInput } from '../types';

// Không tự invalidate cache 'cart' ở đây: CheckoutContainer vẫn đang mount và dùng useCart() (nếu
// làm mới ngay, trang này sẽ thấy giỏ trống và nháy "giỏ hàng trống" trong lúc chờ điều hướng).
// Giỏ được làm mới ở trang kết quả (CheckoutResultContainer → useRefreshCartOnce), áp dụng cho cả
// đơn online lẫn COD (Week8.md 3.6).
export function usePlaceOrder() {
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PlaceOrderInput; idempotencyKey?: string }) =>
      checkoutService.placeOrder(input, idempotencyKey),
  });
}
