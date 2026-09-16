import { useMutation, useQueryClient } from '@tanstack/react-query';

import { archiveProduct } from '../services/product.service';
import { myProductsQueryKey } from './useMyProducts';
import { productQueryKey } from './useProduct';

export function useArchiveProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => archiveProduct(id),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: productQueryKey(product.id) });
      void queryClient.invalidateQueries({
        queryKey: myProductsQueryKey(product.shopId),
      });
    },
  });
}
