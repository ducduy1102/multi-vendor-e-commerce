'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { useNow } from '@/shared/hooks/useNow';

import { useMarkAllNotificationsRead } from '../hooks/useMarkAllNotificationsRead';
import { useMarkNotificationRead } from '../hooks/useMarkNotificationRead';
import { useNotifications } from '../hooks/useNotifications';
import { useUnreadNotificationCount } from '../hooks/useUnreadNotificationCount';
import type { NotificationTab } from '../notification-page-query';
import type { Notification } from '../types';
import { NotificationList } from './NotificationList';
import { NotificationTabs } from './NotificationTabs';

interface NotificationsContainerProps {
  tab: NotificationTab;
}

// Trang `/notifications` hoàn chỉnh: tab, nút "Đánh dấu tất cả đã đọc", danh sách. Container: nối UI thuần với hook.
// Bấm vào một dòng ⇒ đánh dấu đã đọc (lạc quan, không chặn điều hướng) rồi `<Link>` trong dòng tự điều hướng. Dữ liệu được
// giữ tươi bằng sự kiện real-time ở `NotificationRealtimeSync` (mount MỘT lần ở layout) — container KHÔNG tự mount hook
// đồng bộ. Không unit test (rules/frontend.md mục 8), kiểm bằng Playwright.
export function NotificationsContainer({ tab }: NotificationsContainerProps) {
  const t = useTranslations('notification');
  const now = useNow();

  const notifications = useNotifications(tab);
  const unreadCount = useUnreadNotificationCount({ enabled: true });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = useMemo(
    () => notifications.data?.pages.flatMap((page) => page.items) ?? [],
    [notifications.data],
  );
  const unread = unreadCount.data ?? 0;

  function handleOpen(notification: Notification) {
    // Đã đọc rồi thì không gọi lại (server idempotent nhưng đỡ một request).
    if (notification.readAt === null) markRead.mutate(notification.id);
  }

  function handleMarkAll() {
    markAllRead.mutate(undefined, { onError: () => toast.error(t('markAllReadError')) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Vùng live: trình đọc màn hình nghe thấy khi số chưa đọc đổi (thông báo mới tới, đánh dấu đã đọc). */}
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {t('unreadSummary', { count: unread })}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-9"
          disabled={unread === 0 || markAllRead.isPending}
          onClick={handleMarkAll}
        >
          {markAllRead.isPending ? t('markAllReadPending') : t('markAllRead')}
        </Button>
      </div>

      <NotificationTabs activeTab={tab} />

      <NotificationList
        items={items}
        filter={tab}
        now={now}
        isPending={notifications.isPending}
        isError={notifications.isError}
        hasMore={notifications.hasNextPage}
        isFetchingMore={notifications.isFetchingNextPage}
        isFetchMoreError={notifications.isFetchNextPageError}
        onOpen={handleOpen}
        onLoadMore={() => void notifications.fetchNextPage()}
        onRetry={() => void notifications.refetch()}
      />
    </div>
  );
}
