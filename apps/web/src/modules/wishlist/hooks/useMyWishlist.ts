import { useQuery } from '@tanstack/react-query';

import * as wishlistService from '../services/wishlist.service';

export function myWishlistQueryKey() {
  return ['wishlist', 'mine'] as const;
}

// Không cần `enabled` gate như useWishlistStatus (WishlistButton render ở
// mọi trang chi tiết sản phẩm kể cả guest) — route /wishlist đã bị chặn ở
// proxy.ts (PROTECTED_PATH_PREFIXES) cho user chưa đăng nhập, tới được đây
// nghĩa là chắc chắn đã có session.
export function useMyWishlist() {
  return useQuery({
    queryKey: myWishlistQueryKey(),
    queryFn: () => wishlistService.listMyWishlist(),
  });
}
