import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { at, makeNotification, notificationsData, uuid } from '../notification-test-data';
import type { NotificationUnreadCount } from '../types';
import type { NotificationsData } from './notification-cache';
import { handleNewNotification } from './notification-realtime-handlers';
import {
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';

let queryClient: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  vi.useRealTimers();
});

const invalidatedKeys = () =>
  invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);

describe('handleNewNotification', () => {
  it('chèn thông báo vào đầu các danh sách đã nạp', () => {
    queryClient.setQueryData(
      notificationListQueryKey('all'),
      notificationsData([makeNotification({ id: uuid(1) })]),
    );

    handleNewNotification(queryClient, makeNotification({ id: uuid(9), createdAt: at(5) }));

    const data = queryClient.getQueryData<NotificationsData>(notificationListQueryKey('all'));
    expect(data?.pages[0].items.map((n) => n.id)).toEqual([uuid(9), uuid(1)]);
  });

  it('KHÔNG tự cộng +1 huy hiệu (sự kiện không kèm số; tự cộng sẽ đếm đôi nếu huy hiệu vừa được tải sau đó)', () => {
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 4,
    });

    handleNewNotification(queryClient, makeNotification({ id: uuid(9) }));

    expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
      unreadCount: 4,
    });
  });

  it('hẹn tải lại huy hiệu THEO LÔ: nhiều thông báo dồn dập chỉ một lần tải', () => {
    handleNewNotification(queryClient, makeNotification({ id: uuid(1) }));
    handleNewNotification(queryClient, makeNotification({ id: uuid(2) }));
    handleNewNotification(queryClient, makeNotification({ id: uuid(3) }));
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);

    expect(invalidatedKeys()).toEqual([NOTIFICATION_UNREAD_COUNT_QUERY_KEY]);
  });

  it('danh sách chưa nạp thì không bị tạo ra nhưng huy hiệu vẫn được hẹn tải lại', () => {
    handleNewNotification(queryClient, makeNotification({ id: uuid(9) }));
    vi.advanceTimersByTime(250);

    expect(queryClient.getQueryData(notificationListQueryKey('all'))).toBeUndefined();
    expect(invalidatedKeys()).toEqual([NOTIFICATION_UNREAD_COUNT_QUERY_KEY]);
  });
});
