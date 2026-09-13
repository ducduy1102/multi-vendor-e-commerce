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

  return useMutation({
    mutationFn: ({ id, values }: UpdateShopVariables) => updateShop(id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myShopQueryKey });
    },
  });
}
