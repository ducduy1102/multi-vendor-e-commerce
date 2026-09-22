import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateProductInput } from '@ecommerce/types';

import { updateProduct } from '../services/product.service';
import { myProductsQueryKey } from './useMyProducts';
import { productQueryKey } from './useProduct';

interface UpdateProductVariables {
  id: string;
  values: UpdateProductInput;
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, values }: UpdateProductVariables) => updateProduct(id, values),
    onSuccess: (product, { id }) => {
      void queryClient.invalidateQueries({ queryKey: productQueryKey(id) });
      void queryClient.invalidateQueries({
        queryKey: myProductsQueryKey(product.shopId),
      });
    },
  });
}
