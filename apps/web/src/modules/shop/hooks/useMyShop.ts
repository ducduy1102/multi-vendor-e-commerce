import { useQuery } from '@tanstack/react-query';

import { getMyShop } from '../services/shop.service';

export const myShopQueryKey = ['shop', 'me'] as const;

// `data` null nghĩa là user chưa có shop (không phải lỗi) — xem
// shop.service.ts getMyShop(). `options.enabled` để Header (render ở MỌI
// trang, kể cả trang guest) tắt query này khi chưa đăng nhập — gọi
// `getMyShop()` lúc chưa có cookie sẽ nhận 401 (không phải 404 "chưa có
// shop"), bị coi là lỗi thật và tự retry vô ích.
export function useMyShop(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: myShopQueryKey,
    queryFn: getMyShop,
    enabled: options?.enabled,
  });
}
