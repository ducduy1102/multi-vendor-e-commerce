import { useInfiniteQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as notificationService from '../services/notification.service';
import type { NotificationFilter } from '../types';
import { notificationListQueryKey } from './notification-query-keys';

// Hộp thông báo của người đang đăng nhập: mới nhất trước, tải thêm theo con trỏ (`fetchNextPage`). Mỗi bộ lọc ("Tất
// cả" / "Chưa đọc") là một danh sách riêng trong cache. Real-time giữ danh sách tươi (useNotificationRealtimeSync) nên
// không thăm dò định kỳ. `enabled` để nơi dùng chỉ nạp khi chắc chắn đã đăng nhập (trang /notifications đã chặn khách ở
// proxy.ts nên luôn bật).
export function useNotifications(filter: NotificationFilter, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: notificationListQueryKey(filter),
    queryFn: ({ pageParam }) =>
      notificationService.listNotifications({
        cursor: pageParam,
        unreadOnly: filter === 'unread',
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: shouldRetryQuery,
  });
}
