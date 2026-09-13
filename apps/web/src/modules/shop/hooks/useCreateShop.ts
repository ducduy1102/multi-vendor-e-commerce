import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateShopInput } from '@ecommerce/types';

import { createShop } from '../services/shop.service';
import { myShopQueryKey } from './useMyShop';

export function useCreateShop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: CreateShopInput) => createShop(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myShopQueryKey });
    },
  });
}
