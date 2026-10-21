'use client';

import { useAuthStore } from '@/modules/auth';
import { useChatRealtimeSync } from '@/modules/chat';
import { useMyShop } from '@/modules/shop';

// Giữ dữ liệu chat luôn tươi cho cả phiên bằng sự kiện real-time: tin mới ⇒ cập nhật danh sách/huy hiệu, nối lại ⇒ làm
// mới để lấp khoảng trống (xem useChatRealtimeSync). Mount MỘT lần ở layout (trong RealtimeProvider) thay vì mỗi nơi
// tự mount — Header cần huy hiệu ở mọi trang, hộp thư cần danh sách, và hai bản cùng chạy chỉ nhân đôi việc. Hai phạm
// vi: hộp thư người mua (đã đăng nhập) và hộp thư shop (khi đã có shop); phạm vi nào chưa có thì `enabled: false`.
//
// Component này chỉ được nạp động và chỉ dựng khi ĐÃ đăng nhập (lazy-chat.tsx), nên khách vãng lai không tải mã chat.
// KHÔNG giao việc dọn dữ liệu riêng tư khi đổi tài khoản cho component này: nó nạp trễ nên có thể chưa mount kịp (mạng
// chập chờn) — việc đó đi qua sổ đăng ký ở shared/lib/session-reset.ts.
export function ChatRealtimeSync() {
  const user = useAuthStore((state) => state.user);
  const isSignedIn = user !== null;
  const myShop = useMyShop({ enabled: isSignedIn });
  const shopId = isSignedIn ? (myShop.data?.id ?? null) : null;

  useChatRealtimeSync({ role: 'BUYER' }, { enabled: isSignedIn });
  useChatRealtimeSync({ role: 'SHOP', shopId: shopId ?? '' }, { enabled: shopId !== null });

  return null;
}
