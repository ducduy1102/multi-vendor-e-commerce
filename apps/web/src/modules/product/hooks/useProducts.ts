import { useQuery } from '@tanstack/react-query';
import type { ListProductsQuery } from '@ecommerce/types';

import { listProducts } from '../services/product.service';

export function productsQueryKey(params: Partial<ListProductsQuery> = {}) {
  return ['products', 'list', params] as const;
}

// Trang chủ lẫn trang danh sách public đều dùng chung hook này (đúng
// Week4.md Bước 1.12 — không có endpoint /products/featured riêng), chỉ
// khác nhau ở `params` truyền vào.
export function useProducts(params: Partial<ListProductsQuery> = {}) {
  return useQuery({
    queryKey: productsQueryKey(params),
    queryFn: () => listProducts(params),
  });
}
