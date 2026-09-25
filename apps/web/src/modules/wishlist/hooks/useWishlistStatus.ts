import { useQuery } from '@tanstack/react-query';

import * as wishlistService from '../services/wishlist.service';

export function wishlistStatusQueryKey(productId: string) {
  return ['wishlist', 'status', productId] as const;
}

// `enabled` truyền từ ngoài vào (WishlistButton tự biết user đã đăng nhập
// hay chưa qua useAuthStore) — không tự gọi API khi chưa đăng nhập, tránh
// tốn 1 request 401 vô ích (mọi route wishlist đều bắt buộc JwtAuthGuard).
export function useWishlistStatus(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: wishlistStatusQueryKey(productId),
    queryFn: () => wishlistService.getWishlistStatus(productId),
    enabled,
  });
}
