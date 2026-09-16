import { useQuery } from '@tanstack/react-query';

import { getMyProducts } from '../services/product.service';

export function myProductsQueryKey(shopId: string) {
  return ['products', 'mine', shopId] as const;
}

// Danh sách product của shop mình (mọi status) — trang quản lý Seller.
export function useMyProducts(shopId: string) {
  return useQuery({
    queryKey: myProductsQueryKey(shopId),
    queryFn: () => getMyProducts(shopId),
    enabled: Boolean(shopId),
  });
}
