import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@/shared/lib/api-client';
import { getErrorCode } from '@/shared/lib/error-codes';

import * as checkoutService from '../services/checkout.service';
import type { PreviewCheckoutInput } from '../types';

export function checkoutPreviewQueryKey(input: PreviewCheckoutInput) {
  return ['checkout', 'preview', input.addressId ?? null, input.voucherCode ?? ''] as const;
}

// Lỗi 4xx là lỗi của request (chưa chọn đúng địa chỉ, giỏ hàng...), thử lại vô ích.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

// POST /checkout/preview (2.7b) — gọi lại khi đổi địa chỉ/mã voucher (queryKey đổi theo input).
// Giỏ trống/không còn item khả dụng BE trả 400 NO_PURCHASABLE_ITEMS — coi là 1 KẾT QUẢ hợp lệ
// (`data: null`, trạng thái "trống"), không phải lỗi query, để CheckoutContainer không bị treo ở
// nhánh lỗi/thử lại vô ích cho 1 tình huống rất bình thường (giỏ trống khi vào thẳng /checkout).
export function useCheckoutPreview(input: PreviewCheckoutInput, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: checkoutPreviewQueryKey(input),
    queryFn: async () => {
      try {
        return await checkoutService.previewCheckout(input);
      } catch (error) {
        if (error instanceof ApiError && getErrorCode(error) === 'NO_PURCHASABLE_ITEMS') {
          return null;
        }
        throw error;
      }
    },
    enabled: options?.enabled,
    retry: shouldRetry,
  });
}
