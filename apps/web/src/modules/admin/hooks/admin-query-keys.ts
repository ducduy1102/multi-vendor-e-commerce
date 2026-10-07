import type { AdminShopListQuery } from '../types';

// Mọi query key của module admin khai ở ĐÂY (1 chỗ duy nhất, như order-query-keys) — hook đọc và hook
// mutation dùng chung, tránh gõ tay 2 nơi rồi lệch nhau.

// Tiền tố của MỌI danh sách shop (mọi tab/trang) — dùng để invalidate: 1 shop đổi trạng thái là rời
// tab này sang tab khác nên mọi tab đều cũ.
export function adminShopListsQueryKey() {
  return ['admin', 'shops', 'list'] as const;
}

export function adminShopListQueryKey(query: Partial<AdminShopListQuery>) {
  return [...adminShopListsQueryKey(), query] as const;
}
