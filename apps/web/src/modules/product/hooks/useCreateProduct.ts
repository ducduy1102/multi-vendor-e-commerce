import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateProductInput } from '@ecommerce/types';

import { createProduct } from '../services/product.service';
import { myProductsQueryKey } from './useMyProducts';

interface CreateProductVariables {
  shopId: string;
  values: CreateProductInput;
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shopId, values }: CreateProductVariables) => createProduct(shopId, values),
    onSuccess: (_product, { shopId }) => {
      void queryClient.invalidateQueries({ queryKey: myProductsQueryKey(shopId) });
    },
  });
}
