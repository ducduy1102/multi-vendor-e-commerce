'use client';

import { useTranslations } from 'next-intl';

import { CountBadge } from '@/shared/components/CountBadge';
import { useChatBadges } from '@/shared/hooks/useChatBadges';

interface ChatUnreadBadgeProps {
  // 'buyer' = hộp thư người mua (`/chat`), 'shop' = hộp thư của shop mình (`/seller/chat`) — hai con số riêng vì một
  // người có thể vừa mua vừa bán.
  scope: 'buyer' | 'shop';
  // Truyền `static ml-auto` khi đặt inline trong một mục menu (xem CountBadge).
  className?: string;
}

// Huy hiệu số tin chưa đọc + bản chữ cho trình đọc màn hình (huy hiệu tròn là `aria-hidden`). Tách khỏi Header/AccountSheet
// để chúng KHÔNG import `useChatBadges` (kéo theo mã dữ liệu chat) một cách tĩnh: component này chỉ được nạp động qua
// `LazyChatUnreadBadge` khi đã có người đăng nhập, nên khách vãng lai không tải mã chat nào (xem lazy-chat.tsx).
export function ChatUnreadBadge({ scope, className }: ChatUnreadBadgeProps) {
  const tChat = useTranslations('chat');
  const { buyerUnread, shopUnread } = useChatBadges();
  const count = scope === 'buyer' ? buyerUnread : shopUnread;

  return (
    <>
      <CountBadge count={count} className={className} />
      {count > 0 ? (
        <span className="sr-only">{tChat('conversationUnreadSr', { count })}</span>
      ) : null}
    </>
  );
}
