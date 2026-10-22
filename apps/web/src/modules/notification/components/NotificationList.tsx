'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import type { Notification } from '../types';
import { NOTIFICATION_LIST_FRAME_CLASS } from './notification-layout.constants';
import { NotificationItem } from './NotificationItem';
import { NotificationListSkeleton } from './NotificationListSkeleton';
import { NotificationEmptyState, NotificationErrorState } from './NotificationStates';

interface NotificationListProps {
  items: Notification[];
  // Tab đang xem: quyết định lời ở trạng thái trống ("chưa có" so với "đã đọc hết").
  filter: 'all' | 'unread';
  // "Bây giờ" (ms) để dựng nhãn thời gian tương đối.
  now: number;
  isPending: boolean;
  isError: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  // Lần tải thêm gần nhất lỗi (danh sách đã có vẫn hiện, kèm lời nhắc thử lại ở nút "Tải thêm").
  isFetchMoreError: boolean;
  onOpen: (notification: Notification) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

// Danh sách thông báo (component THUẦN — dữ liệu và hành động qua props). Đủ ba trạng thái: đang tải (skeleton),
// lỗi (có nút thử lại — chỉ khi chưa có dữ liệu nào, còn có dữ liệu cũ thì vẫn hiện danh sách), trống (lời gợi ý khác nhau
// cho "Tất cả" và "Chưa đọc"). Phân trang theo con trỏ nên có nút "Tải thêm" ở cuối.
export function NotificationList({
  items,
  filter,
  now,
  isPending,
  isError,
  hasMore,
  isFetchingMore,
  isFetchMoreError,
  onOpen,
  onLoadMore,
  onRetry,
}: NotificationListProps) {
  const t = useTranslations('notification');

  if (isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t('listLoadingSrOnly')}</span>
        <NotificationListSkeleton />
      </div>
    );
  }

  if (isError && items.length === 0) {
    return <NotificationErrorState message={t('loadError')} onRetry={onRetry} />;
  }

  if (items.length === 0) {
    return filter === 'unread' ? (
      <NotificationEmptyState title={t('emptyUnreadTitle')} hint={t('emptyUnreadHint')} />
    ) : (
      <NotificationEmptyState title={t('emptyAllTitle')} hint={t('emptyAllHint')} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label={t('listLabel')}
        className={cn(NOTIFICATION_LIST_FRAME_CLASS, 'divide-y divide-border')}
      >
        {items.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            now={now}
            onOpen={onOpen}
          />
        ))}
      </ul>

      {hasMore ? (
        <div className="flex flex-col items-center gap-2">
          {isFetchMoreError ? (
            <p role="alert" className="text-xs text-destructive">
              {t('loadMoreError')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={isFetchingMore}
            onClick={onLoadMore}
          >
            {isFetchingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
