import {
  wishlistListResponseSchema,
  wishlistStatusSchema,
  type WishlistListResponse,
  type WishlistStatus,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Mọi route wishlist đều bắt buộc đăng nhập (Week5.md Bước 1.12, BE
// @UseGuards(JwtAuthGuard) ở cấp @Controller()) — không có nhánh guest.
// Cả 3 API add/remove/status trả cùng shape {isWishlisted} (Bước 1.18/2.7),
// không nested thêm key nào khác — khác các API product (`{product: ...}`).
export async function getWishlistStatus(productId: string): Promise<WishlistStatus> {
  const data = await apiFetch<unknown>(`/wishlist/${productId}/status`, {
    method: 'GET',
  });
  return wishlistStatusSchema.parse(data);
}

export async function addToWishlist(productId: string): Promise<WishlistStatus> {
  const data = await apiFetch<unknown>(`/wishlist/${productId}`, {
    method: 'POST',
  });
  return wishlistStatusSchema.parse(data);
}

export async function removeFromWishlist(productId: string): Promise<WishlistStatus> {
  const data = await apiFetch<unknown>(`/wishlist/${productId}`, {
    method: 'DELETE',
  });
  return wishlistStatusSchema.parse(data);
}

export async function listMyWishlist(): Promise<WishlistListResponse> {
  const data = await apiFetch<unknown>('/wishlist', { method: 'GET' });
  return wishlistListResponseSchema.parse(data);
}
