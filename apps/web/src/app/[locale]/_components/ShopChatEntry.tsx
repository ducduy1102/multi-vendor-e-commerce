'use client';

import { useAuthStore } from '@/modules/auth';
import { ShopChatButton } from '@/modules/chat';
import { useMyShop } from '@/modules/shop';
import { Skeleton } from '@/shared/components/ui/skeleton';

interface ShopChatEntryProps {
  shopId: string;
}

// Điểm vào "Chat với shop" cho trang shop công khai (Week10.md 5.4) — COMPOSITION ROOT: nút cần biết người xem đã đăng
// nhập chưa (`modules/auth`) và có phải chủ shop này không (`modules/shop`), còn chat không được import hai module đó
// (rules/general.md mục 1) nên nơi duy nhất biết cả ba là app/. Thư mục `_components` là private folder của Next.js.
//
// Chưa biết kết quả thì chiếm chỗ bằng skeleton đúng cỡ nút (không nhảy bố cục, không nháy nút "đăng nhập để chat" rồi
// đổi thành nút thật ở người đã đăng nhập): chờ AuthHydrator hỏi xong /auth/me, rồi (nếu đã đăng nhập) chờ "shop của
// tôi" để biết có phải shop của chính mình không. Lỗi tải "shop của tôi" ⇒ vẫn hiện nút: BE chặn chat với shop của
// chính mình bằng 409 CHAT_OWN_SHOP, người dùng thấy câu giải thích.
export function ShopChatEntry({ shopId }: ShopChatEntryProps) {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const myShop = useMyShop({ enabled: user !== null });

  const isResolving = isHydrating || (user !== null && myShop.isPending);
  if (isResolving) {
    return <Skeleton aria-hidden="true" className="h-8 w-28 motion-reduce:animate-none" />;
  }

  return (
    <ShopChatButton
      shopId={shopId}
      isAuthenticated={user !== null}
      isOwnShop={myShop.data?.id === shopId}
    />
  );
}
