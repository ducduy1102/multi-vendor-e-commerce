'use client';

import { ShopChatButton } from '@/modules/chat';
import { useOrder } from '@/modules/order';

// Điểm vào "Chat với shop" ở chi tiết đơn của người mua (Week10.md 5.4) — composition root: `modules/order` không
// import `modules/chat` nên page.tsx truyền nút này làm `chatSlot` cho OrderDetailContainer. Lấy shop của đơn bằng
// cùng truy vấn `useOrder` mà container đã chạy (cùng khoá ⇒ dùng chung cache, không gọi API thêm). Trang /orders đã
// bị proxy.ts chặn khách nên người xem luôn đã đăng nhập; người mua không bao giờ là chủ shop của đơn mình mua
// (giỏ hàng chặn CART_OWN_SHOP_ITEM), nên không cần kiểm "shop của tôi".
export function OrderChatEntry({ orderId }: { orderId: string }) {
  const order = useOrder(orderId).data;
  if (!order) return null;

  return <ShopChatButton shopId={order.shop.id} isAuthenticated />;
}
