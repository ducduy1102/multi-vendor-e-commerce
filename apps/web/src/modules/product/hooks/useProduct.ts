import { useQuery } from '@tanstack/react-query';

import { getProduct } from '../services/product.service';

export function productQueryKey(id: string) {
  return ['products', 'detail', id] as const;
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: productQueryKey(id),
    queryFn: () => getProduct(id),
    enabled: Boolean(id),
  });
}
