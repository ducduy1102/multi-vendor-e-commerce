import type { OrderListQuery, SellerOrderListQuery } from '../types';

// Mọi query key của module order khai ở ĐÂY (1 chỗ duy nhất, như myShopQueryKey) — hook đọc và hook
// mutation dùng chung, tránh gõ tay 2 nơi rồi lệch nhau. Buyer và seller tách nhánh để làm mới
// bên này không kéo theo bên kia.

// --- Buyer ---------------------------------------------------------------------------------------

// Tiền tố của MỌI danh sách buyer (mọi tab/trang) — dùng để invalidate.
export function orderListsQueryKey() {
  return ['orders', 'buyer', 'list'] as const;
}

export function orderListQueryKey(query: Partial<OrderListQuery>) {
  return [...orderListsQueryKey(), query] as const;
}

export function orderQueryKey(orderId: string) {
  return ['orders', 'buyer', 'detail', orderId] as const;
}

// --- Seller --------------------------------------------------------------------------------------

export function sellerOrderListsQueryKey(shopId: string) {
  return ['orders', 'seller', shopId, 'list'] as const;
}

export function sellerOrderListQueryKey(shopId: string, query: Partial<SellerOrderListQuery>) {
  return [...sellerOrderListsQueryKey(shopId), query] as const;
}

export function sellerOrderQueryKey(shopId: string, orderId: string) {
  return ['orders', 'seller', shopId, 'detail', orderId] as const;
}
