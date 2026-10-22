import type { QueryClient } from '@tanstack/react-query';

import { scheduleInvalidate } from '@/shared/lib/schedule-invalidate';

import type { Notification } from '../types';
import { prependNotification } from './notification-cache';
import { NOTIFICATION_UNREAD_COUNT_QUERY_KEY } from './notification-query-keys';

// `notification:new` thành các thay đổi cache — tách khỏi hook để test được không cần socket/React.
//
// Thông báo vào đầu các danh sách đã nạp (idempotent theo id). Huy hiệu KHÔNG tự cộng +1: server là nguồn đúng của số
// chưa đọc, và tự cộng sẽ đếm đôi khi huy hiệu vừa được tải SAU khi sự kiện tới (sự kiện không kèm số, bài học từ chat)
// — chỉ hẹn một lần tải lại theo lô (nhiều thông báo dồn dập chỉ gây một lần tải).
export function handleNewNotification(queryClient: QueryClient, notification: Notification): void {
  prependNotification(queryClient, notification);
  scheduleInvalidate(queryClient, NOTIFICATION_UNREAD_COUNT_QUERY_KEY);
}
