import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import { cartQueryKeys } from './useCart';

interface UpdateCartItemVariables {
  // id của CartItem (chỉ có với giỏ trong DB, null với guest) — nhận cả
  // itemId lẫn productVariantId để 1 CartLine dùng được cho cả 2 nhánh.
  itemId: string | null;
  productVariantId: string;
  quantity: number;
}

// Đặt số lượng mới (không cộng dồn). Đăng nhập: PATCH theo itemId; guest: ghi
// vào useCartStore theo productVariantId.
export function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, productVariantId, quantity }: UpdateCartItemVariables) => {
      if (useAuthStore.getState().user) {
        if (!itemId) {
          throw new Error('Thiếu itemId của dòng giỏ hàng');
        }
        await cartService.updateCartItem(itemId, quantity);
        return;
      }
      useCartStore.getState().setQuantity(productVariantId, quantity);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
    },
  });
}
