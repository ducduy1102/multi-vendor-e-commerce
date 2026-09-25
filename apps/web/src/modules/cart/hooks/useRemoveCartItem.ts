import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import { cartQueryKeys } from './useCart';

interface RemoveCartItemVariables {
  itemId: string | null;
  productVariantId: string;
}

// Xoá 1 dòng khỏi giỏ. Đăng nhập: DELETE theo itemId (idempotent); guest: bỏ
// khỏi useCartStore theo productVariantId.
export function useRemoveCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, productVariantId }: RemoveCartItemVariables) => {
      if (useAuthStore.getState().user) {
        if (!itemId) {
          throw new Error('Thiếu itemId của dòng giỏ hàng');
        }
        await cartService.removeCartItem(itemId);
        return;
      }
      useCartStore.getState().removeItem(productVariantId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
    },
  });
}
