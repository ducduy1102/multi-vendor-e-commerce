import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import type { AddCartItemInput } from '../types';
import { cartQueryKeys } from './useCart';

// Rẽ nhánh theo user TẠI THỜI ĐIỂM GỌI (đọc getState, không dùng giá trị
// đóng gói lúc render) để không dùng nhầm nhánh nếu user vừa đăng nhập/đăng
// xuất giữa chừng. Đăng nhập: gọi API (BE chặn mềm theo tồn kho, 1.10, lỗi
// 409 nêu rõ trong message). Guest: chỉ ghi vào useCartStore — chưa có API để
// kiểm tồn kho, giỏ hiển thị (POST /cart/quote) sẽ cho biết tồn kho thật.
export function useAddToCart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productVariantId, quantity }: AddCartItemInput) => {
      if (useAuthStore.getState().user) {
        await cartService.addCartItem({ productVariantId, quantity });
        return;
      }
      useCartStore.getState().addItem(productVariantId, quantity);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
    },
  });
}
