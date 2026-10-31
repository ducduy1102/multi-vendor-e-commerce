// Mọi query key của module appeal khai ở ĐÂY (1 chỗ duy nhất) — hook đọc và hook mutation dùng chung, tránh gõ tay 2 nơi rồi
// lệch nhau. Tiền tố `['appeal', ...]` để `SessionCacheReset` xoá cả cache khi đổi tài khoản (module không có store Zustand).
export function shopAppealsQueryKey(shopId: string) {
  return ['appeal', 'shop', shopId] as const;
}

// Kháng nghị sản phẩm bị gỡ (Week11.md 5.8): khoá theo sản phẩm (id sản phẩm là duy nhất toàn sàn nên không cần thêm shopId).
export function productAppealsQueryKey(productId: string) {
  return ['appeal', 'product', productId] as const;
}
