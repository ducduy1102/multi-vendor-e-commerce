'use client';

import { useAuthStore } from '@/modules/auth';
import { useChatRealtimeSync } from '@/modules/chat';
import { useMyShop } from '@/modules/shop';

// Giữ dữ liệu chat luôn tươi cho cả phiên bằng sự kiện real-time: tin mới ⇒ cập nhật danh sách/huy hiệu, nối lại ⇒ làm
// mới để lấp khoảng trống (xem useChatRealtimeSync). Mount MỘT lần ở layout (trong RealtimeProvider) thay vì mỗi nơi
// tự mount — Header cần huy hiệu ở mọi trang, hộp thư cần danh sách, và hai bản cùng chạy chỉ nhân đôi việc. Hai phạm
// vi: hộp thư người mua (đã đăng nhập) và hộp thư shop (khi đã có shop); phạm vi nào chưa có thì `enabled: false`.
export function ChatRealtimeSync() {
  const user = useAuthStore((state) => state.user);
  const isSignedIn = user !== null;
  const myShop = useMyShop({ enabled: isSignedIn });
  const shopId = isSignedIn ? (myShop.data?.id ?? null) : null;

  useChatRealtimeSync({ role: 'BUYER' }, { enabled: isSignedIn });
  useChatRealtimeSync({ role: 'SHOP', shopId: shopId ?? '' }, { enabled: shopId !== null });

  return null;
}
