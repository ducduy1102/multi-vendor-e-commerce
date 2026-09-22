import { useQuery } from '@tanstack/react-query';

import { getCategories } from '../services/product.service';

export const categoriesQueryKey = ['categories'] as const;

// Category ít đổi (chưa có CRUD, Admin category management để dành Tuần 11)
// — cache lâu hơn default, không cần refetch liên tục.
export function useCategories() {
  return useQuery({
    queryKey: categoriesQueryKey,
    queryFn: getCategories,
    staleTime: 5 * 60 * 1000,
  });
}
