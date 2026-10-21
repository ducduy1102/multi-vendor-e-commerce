'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { useAuthStore } from '@/modules/auth';
import { buttonVariants } from '@/shared/components/ui/button';
import { useChatBadges } from '@/shared/hooks/useChatBadges';

import { CountBadge } from './CountBadge';

interface HeaderChatLinkProps {
  // Hiện/ẩn theo breakpoint do nơi đặt quyết định (mobile: hàng 1 bên phải logo; desktop: cạnh giỏ hàng — D8).
  className?: string;
}

// Biểu tượng tin nhắn ở Header (Week10.md 5.5, D8) → `/chat` (hộp thư người mua), kèm huy hiệu số chưa đọc. Chỉ hiện khi
// đã đăng nhập (khách không có hội thoại; chờ AuthHydrator thì cũng chưa hiện). Hộp thư của SHOP có mục riêng + huy
// hiệu trong dropdown tài khoản/AccountSheet. Số chưa đọc cho trình đọc màn hình nằm ở chữ sr-only (huy hiệu aria-hidden).
export function HeaderChatLink({ className }: HeaderChatLinkProps) {
  const t = useTranslations('header');
  const tChat = useTranslations('chat');
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const { buyerUnread } = useChatBadges();

  if (!user) return null;

  const isActive = pathname === '/chat' || pathname.startsWith('/chat/');

  return (
    <div className={className}>
      <Link
        href="/chat"
        aria-current={isActive ? 'page' : undefined}
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <span className="relative flex">
          <MessageCircle aria-hidden="true" />
          <CountBadge count={buyerUnread} />
        </span>
        <span className="sr-only">
          {t('chatLink')}
          {buyerUnread > 0 ? `: ${tChat('conversationUnreadSr', { count: buyerUnread })}` : ''}
        </span>
      </Link>
    </div>
  );
}
