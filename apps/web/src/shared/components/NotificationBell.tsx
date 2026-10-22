'use client';

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { useAuthStore } from '@/modules/auth';
import { useUnreadNotificationCount } from '@/modules/notification';
import { buttonVariants } from '@/shared/components/ui/button';

import { CountBadge } from './CountBadge';

interface NotificationBellProps {
  // Hiện/ẩn theo breakpoint do nơi đặt quyết định (mobile: hàng 1 bên phải logo; desktop: cạnh icon tin nhắn — D8).
  className?: string;
}

// Chuông thông báo ở Header (Week10.md 8.3, D8) → `/notifications`, kèm huy hiệu số chưa đọc (`99+` khi quá 99, ẩn khi 0).
// Chỉ hiện khi đã đăng nhập (khách không có thông báo). LINK thật (`buttonVariants` + `Link`), không popover — chưa duyệt
// primitive mới. Số chưa đọc cho trình đọc màn hình nằm ở chữ sr-only (huy hiệu tròn là `aria-hidden`); phía nhận cập nhật
// qua sự kiện real-time ở `NotificationRealtimeSync` (mount một lần ở layout), nên huy hiệu đổi mà không cần tải lại.
export function NotificationBell({ className }: NotificationBellProps) {
  const t = useTranslations('header');
  const tNotification = useTranslations('notification');
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const unread = useUnreadNotificationCount({ enabled: user !== null }).data ?? 0;

  if (!user) return null;

  const isActive = pathname === '/notifications';

  return (
    <div className={className}>
      <Link
        href="/notifications"
        aria-current={isActive ? 'page' : undefined}
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <span className="relative flex">
          <Bell aria-hidden="true" />
          <CountBadge count={unread} />
        </span>
        <span className="sr-only">
          {t('notificationsLink')}
          {unread > 0 ? `: ${tNotification('unreadSummary', { count: unread })}` : ''}
        </span>
      </Link>
    </div>
  );
}
