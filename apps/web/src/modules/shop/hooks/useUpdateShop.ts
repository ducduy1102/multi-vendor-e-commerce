import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateShopInput } from '@ecommerce/types';

import { updateShop } from '../services/shop.service';
import { myShopQueryKey } from './useMyShop';

interface UpdateShopVariables {
  id: string;
  values: UpdateShopInput;
}

export function useUpdateShop() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: myShopQueryKey });

  return useMutation({
    mutationFn: ({ id, values }: UpdateShopVariables) => updateShop(id, values),
    onSuccess: refresh,
    // 409 SHOP_EDIT_NOT_ALLOWED: shop vừa sang PENDING/SUSPENDED nên form đang hiển thị đã cũ — làm mới để
    // form khoá đúng ngay, không bắt chủ shop tự tải lại trang.
    onError: refresh,
  });
}
