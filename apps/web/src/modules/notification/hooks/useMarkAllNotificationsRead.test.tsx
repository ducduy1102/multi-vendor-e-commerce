import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { makeNotification, notificationsData, uuid } from '../notification-test-data';
import * as notificationService from '../services/notification.service';
import type { NotificationUnreadCount } from '../types';
import type { NotificationsData } from './notification-cache';
import {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';
import { useMarkAllNotificationsRead } from './useMarkAllNotificationsRead';

vi.mock('../services/notification.service');

const markAllReadMock = vi.mocked(notificationService.markAllRead);
const ALL = notificationListQueryKey('all');
const UNREAD = notificationListQueryKey('unread');

describe('useMarkAllNotificationsRead', () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient['invalidateQueries']>;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    markAllReadMock.mockReset();
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(2) }), makeNotification({ id: uuid(1) })]),
    );
    queryClient.setQueryData(
      UNREAD,
      notificationsData([makeNotification({ id: uuid(2) }), makeNotification({ id: uuid(1) })]),
    );
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  const keysInvalidated = () =>
    invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);

  it('LẠC QUAN: mọi dòng đã đọc, "Chưa đọc" rỗng và huy hiệu về 0 NGAY, trước khi server trả lời', async () => {
    let finish: (value: { updatedCount: number }) => void = () => {};
    markAllReadMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

    act(() => result.current.mutate());

    await waitFor(() =>
      expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
        unreadCount: 0,
      }),
    );
    const all = queryClient.getQueryData<NotificationsData>(ALL);
    expect(all?.pages[0].items.every((n) => n.readAt !== null)).toBe(true);
    expect(queryClient.getQueryData<NotificationsData>(UNREAD)?.pages[0].items).toEqual([]);

    await act(async () => finish({ updatedCount: 2 }));
  });

  it('thành công ⇒ tải lại huy hiệu, KHÔNG tải lại danh sách', async () => {
    markAllReadMock.mockResolvedValue({ updatedCount: 2 });
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(keysInvalidated()).toEqual([NOTIFICATION_UNREAD_COUNT_QUERY_KEY]);
  });

  it('LỖI ⇒ tải lại các danh sách và huy hiệu', async () => {
    markAllReadMock.mockRejectedValue(new ApiError('boom', 500));
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    expect(keysInvalidated()).toEqual(
      expect.arrayContaining([NOTIFICATION_LIST_QUERY_KEY, NOTIFICATION_UNREAD_COUNT_QUERY_KEY]),
    );
  });

  it('gọi khi không còn gì chưa đọc vẫn an toàn (idempotent)', async () => {
    markAllReadMock.mockResolvedValue({ updatedCount: 0 });
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
      await result.current.mutateAsync();
    });

    expect(markAllReadMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
      unreadCount: 0,
    });
  });
});
