import {
  cartItemResponseSchema,
  cartResponseSchema,
  type AddCartItemInput,
  type CartItemInput,
  type CartItemRow,
  type CartView,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Chỉ gọi API, không có logic UI. Cả getCart (đã đăng nhập) lẫn quoteCart
// (guest) trả cùng 1 CartView (Week6.md 1.7) — chọn nhánh nào là việc của hook
// useCart, không phải của service. Giá/tên/tồn kho luôn lấy live từ BE.

// voucherCode rỗng/khoảng trắng coi như không có mã, không gửi lên.
function cartPath(voucherCode?: string): string {
  const code = voucherCode?.trim();
  return code ? `/cart?voucherCode=${encodeURIComponent(code)}` : '/cart';
}

export async function getCart(voucherCode?: string): Promise<CartView> {
  const data = await apiFetch<unknown>(cartPath(voucherCode), { method: 'GET' });
  return cartResponseSchema.parse(data).cart;
}

export async function quoteCart(items: CartItemInput[], voucherCode?: string): Promise<CartView> {
  const data = await apiFetch<unknown>('/cart/quote', {
    method: 'POST',
    body: JSON.stringify({ items, voucherCode: voucherCode?.trim() || undefined }),
  });
  return cartResponseSchema.parse(data).cart;
}

// Gộp giỏ guest vào giỏ DB sau khi đăng nhập (Week6.md 1.8), trả giỏ mới.
export async function mergeCart(items: CartItemInput[]): Promise<CartView> {
  const data = await apiFetch<unknown>('/cart/merge', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
  return cartResponseSchema.parse(data).cart;
}

export async function addCartItem(input: AddCartItemInput): Promise<CartItemRow> {
  const data = await apiFetch<unknown>('/cart/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return cartItemResponseSchema.parse(data).item;
}

export async function updateCartItem(itemId: string, quantity: number): Promise<CartItemRow> {
  const data = await apiFetch<unknown>(`/cart/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity }),
  });
  return cartItemResponseSchema.parse(data).item;
}

export async function removeCartItem(itemId: string): Promise<void> {
  await apiFetch<unknown>(`/cart/items/${itemId}`, { method: 'DELETE' });
}
