import { useQuery } from '@tanstack/react-query';

import { getMyShop } from '../services/shop.service';

export const myShopQueryKey = ['shop', 'me'] as const;

// `data` null nghĩa là user chưa có shop (không phải lỗi) — xem
// shop.service.ts getMyShop().
export function useMyShop() {
  return useQuery({
    queryKey: myShopQueryKey,
    queryFn: getMyShop,
  });
}
