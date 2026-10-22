'use client';

import { useTranslations } from 'next-intl';

import { useAuthStore } from '@/modules/auth';
import { useUnreadNotificationCount } from '@/modules/notification';
import { CountBadge } from '@/shared/components/CountBadge';

interface NotificationUnreadBadgeProps {
  // Truyền `static ml-auto` khi đặt inline trong một mục menu (xem CountBadge).
  className?: string;
}

// Huy hiệu số thông báo chưa đọc cho mục "Thông báo" ở dropdown tài khoản/AccountSheet + bản chữ cho trình đọc màn hình
// (huy hiệu tròn là `aria-hidden`). Tách khỏi Header/AccountSheet để chúng KHÔNG import `@/modules/notification` một cách tĩnh:
// component này chỉ được nạp động qua `LazyNotificationUnreadBadge` khi đã có người đăng nhập, nên khách vãng lai không
// tải mã thông báo nào (xem lazy-notification.tsx).
export function NotificationUnreadBadge({ className }: NotificationUnreadBadgeProps) {
  const tNotification = useTranslations('notification');
  const user = useAuthStore((state) => state.user);
  const unread = useUnreadNotificationCount({ enabled: user !== null }).data ?? 0;

  return (
    <>
      <CountBadge count={unread} className={className} />
      {unread > 0 ? (
        <span className="sr-only">{tNotification('unreadSummary', { count: unread })}</span>
      ) : null}
    </>
  );
}
