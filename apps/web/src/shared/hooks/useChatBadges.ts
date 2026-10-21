'use client';

import { useChatUnreadCount } from '@/modules/chat';
import { useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';

export interface ChatBadges {
  // Id shop của người dùng (null = chưa đăng nhập, chưa có shop, hoặc chưa tải xong).
  shopId: string | null;
  // Tin chưa đọc ở hộp thư NGƯỜI MUA (`/chat`) và hộp thư của SHOP mình (`/seller/chat`) — hai con số riêng vì một
  // người có thể vừa mua vừa bán. 0 khi chưa biết/chưa đăng nhập.
  buyerUnread: number;
  shopUnread: number;
}

// Huy hiệu tin nhắn cho Header (desktop + mobile), dropdown tài khoản và AccountSheet (Week10.md 5.5): đọc số chưa đọc
// của hai phạm vi qua TanStack Query nên mọi nơi gọi hook này dùng chung MỘT truy vấn mỗi phạm vi (khử trùng theo
// khoá). Chỉ ĐỌC — dữ liệu được giữ tươi bằng sự kiện real-time ở `ChatRealtimeSync` (mount một lần ở layout), không
// phải bằng thăm dò. Nằm ở shared/ vì cần cả `auth` (đã đăng nhập chưa), `shop` ("shop của tôi") lẫn `chat` mà các module
// đó không được import nhau (rules/general.md mục 1).
export function useChatBadges(): ChatBadges {
  const user = useAuthStore((state) => state.user);
  const isSignedIn = user !== null;
  const myShop = useMyShop({ enabled: isSignedIn });
  const shopId = isSignedIn ? (myShop.data?.id ?? null) : null;

  const buyerCount = useChatUnreadCount({ role: 'BUYER' }, { enabled: isSignedIn });
  // `shopId ?? ''` chỉ để có khoá hợp lệ khi chưa có shop — truy vấn bị tắt (`enabled`) nên không bao giờ chạy.
  const shopCount = useChatUnreadCount(
    { role: 'SHOP', shopId: shopId ?? '' },
    { enabled: shopId !== null },
  );

  return {
    shopId,
    buyerUnread: isSignedIn ? (buyerCount.data ?? 0) : 0,
    shopUnread: shopId !== null ? (shopCount.data ?? 0) : 0,
  };
}
