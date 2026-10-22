import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { at, makeNotification, notificationsData, uuid } from '../notification-test-data';
import * as notificationService from '../services/notification.service';
import type { NotificationUnreadCount } from '../types';
import type { NotificationsData } from './notification-cache';
import {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';
import { useMarkNotificationRead } from './useMarkNotificationRead';

vi.mock('../services/notification.service');

const markReadMock = vi.mocked(notificationService.markRead);
const ALL = notificationListQueryKey('all');
const UNREAD = notificationListQueryKey('unread');

describe('useMarkNotificationRead', () => {
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
    markReadMock.mockReset();
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(2) }), makeNotification({ id: uuid(1) })]),
    );
    queryClient.setQueryData(UNREAD, notificationsData([makeNotification({ id: uuid(2) })]));
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  const items = (key: readonly unknown[]) =>
    queryClient.getQueryData<NotificationsData>(key)?.pages[0].items ?? [];
  const keysInvalidated = () =>
    invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);

  it('LẠC QUAN: dòng đã đọc, rời tab "Chưa đọc" và huy hiệu giảm 1 NGAY, trước khi server trả lời', async () => {
    let finish: (value: { readAt: string }) => void = () => {};
    markReadMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    act(() => result.current.mutate(uuid(2)));

    await waitFor(() => expect(items(ALL).find((n) => n.id === uuid(2))?.readAt).not.toBeNull());
    expect(items(UNREAD)).toHaveLength(0);
    expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
      unreadCount: 1,
    });
    expect(markReadMock).toHaveBeenCalledWith(uuid(2));

    await act(async () => finish({ readAt: at(5) }));
  });

  it('thành công ⇒ tải lại huy hiệu (chốt số đúng), KHÔNG tải lại danh sách', async () => {
    markReadMock.mockResolvedValue({ readAt: at(5) });
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(uuid(2));
    });

    expect(keysInvalidated()).toEqual([NOTIFICATION_UNREAD_COUNT_QUERY_KEY]);
  });

  it('LỖI ⇒ tải lại các danh sách (lấy lại trạng thái đúng của server) và huy hiệu', async () => {
    markReadMock.mockRejectedValue(new ApiError('Notification not found', 404));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(uuid(2)).catch(() => {});
    });

    expect(keysInvalidated()).toEqual(
      expect.arrayContaining([NOTIFICATION_LIST_QUERY_KEY, NOTIFICATION_UNREAD_COUNT_QUERY_KEY]),
    );
  });

  it('thông báo ĐÃ đọc từ trước ⇒ huy hiệu KHÔNG bị trừ lần nữa', async () => {
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(2), readAt: at(1) })]),
    );
    queryClient.setQueryData(UNREAD, notificationsData([]));
    markReadMock.mockResolvedValue({ readAt: at(1) });
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(uuid(2));
    });

    expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
      unreadCount: 2,
    });
  });

  it('thông báo không nằm trong danh sách đã nạp (bấm từ toast) ⇒ không trừ lạc quan, vẫn gọi API và tải lại huy hiệu', async () => {
    markReadMock.mockResolvedValue({ readAt: at(5) });
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(uuid(77));
    });

    expect(queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
      unreadCount: 2,
    });
    expect(markReadMock).toHaveBeenCalledWith(uuid(77));
    expect(keysInvalidated()).toContainEqual(NOTIFICATION_UNREAD_COUNT_QUERY_KEY);
  });
});
