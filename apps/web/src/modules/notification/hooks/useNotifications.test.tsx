import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { makeNotification, uuid } from '../notification-test-data';
import * as notificationService from '../services/notification.service';
import { useNotifications } from './useNotifications';

vi.mock('../services/notification.service');

const listMock = vi.mocked(notificationService.listNotifications);

describe('useNotifications', () => {
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    listMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('"Tất cả": trang đầu không có con trỏ, unreadOnly=false', async () => {
    listMock.mockResolvedValue({ items: [makeNotification()], nextCursor: null });

    const { result } = renderHook(() => useNotifications('all'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMock).toHaveBeenCalledWith({ cursor: undefined, unreadOnly: false });
    expect(result.current.data?.pages[0].items).toHaveLength(1);
  });

  it('"Chưa đọc": gửi unreadOnly=true', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });

    const { result } = renderHook(() => useNotifications('unread'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMock).toHaveBeenCalledWith({ cursor: undefined, unreadOnly: true });
  });

  it('có nextCursor ⇒ hasNextPage; fetchNextPage gửi đúng con trỏ rồi hết khi nextCursor null', async () => {
    listMock
      .mockResolvedValueOnce({ items: [makeNotification({ id: uuid(2) })], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [makeNotification({ id: uuid(1) })], nextCursor: null });

    const { result } = renderHook(() => useNotifications('all'), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(listMock).toHaveBeenNthCalledWith(2, { cursor: 'c1', unreadOnly: false });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.flatMap((p) => p.items.map((n) => n.id))).toEqual([
      uuid(2),
      uuid(1),
    ]);
  });

  it('hai bộ lọc là hai danh sách riêng (không dùng chung cache)', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });

    const { result } = renderHook(
      () => ({ all: useNotifications('all'), unread: useNotifications('unread') }),
      {
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.all.isSuccess && result.current.unread.isSuccess).toBe(true),
    );
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('enabled=false ⇒ KHÔNG gọi API', async () => {
    const { result } = renderHook(() => useNotifications('all', { enabled: false }), { wrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(listMock).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('lỗi 401 không thử lại và lộ ra isError', async () => {
    listMock.mockRejectedValue(new ApiError('Chưa đăng nhập', 401));

    const { result } = renderHook(() => useNotifications('all'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
