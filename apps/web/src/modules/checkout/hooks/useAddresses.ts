import { useQuery } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';

export function addressesQueryKey() {
  return ['addresses'] as const;
}

// Sổ địa chỉ của user hiện tại — dùng ở /checkout (3.4), route đã bị chặn ở
// proxy.ts cho user chưa đăng nhập (đúng pattern useMyWishlist), không cần
// `enabled` gate riêng.
export function useAddresses() {
  return useQuery({
    queryKey: addressesQueryKey(),
    queryFn: () => checkoutService.listAddresses(),
  });
}
