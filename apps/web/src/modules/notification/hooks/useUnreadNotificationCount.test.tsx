import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as notificationService from '../services/notification.service';
import { useUnreadNotificationCount } from './useUnreadNotificationCount';

vi.mock('../services/notification.service');

const getUnreadCountMock = vi.mocked(notificationService.getUnreadCount);

describe('useUnreadNotificationCount', () => {
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    getUnreadCountMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('trả về MỘT SỐ (không phải object)', async () => {
    getUnreadCountMock.mockResolvedValue({ unreadCount: 7 });

    const { result } = renderHook(() => useUnreadNotificationCount({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(7));
  });

  it('enabled=false (khách vãng lai) ⇒ KHÔNG gọi API', async () => {
    const { result } = renderHook(() => useUnreadNotificationCount({ enabled: false }), {
      wrapper,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getUnreadCountMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('nhiều nơi gọi hook cùng lúc dùng chung MỘT truy vấn', async () => {
    getUnreadCountMock.mockResolvedValue({ unreadCount: 3 });

    const { result } = renderHook(
      () => [
        useUnreadNotificationCount({ enabled: true }),
        useUnreadNotificationCount({ enabled: true }),
      ],
      { wrapper },
    );

    await waitFor(() => expect(result.current[1].data).toBe(3));
    expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
  });

  it('lỗi 401 không thử lại', async () => {
    getUnreadCountMock.mockRejectedValue(new ApiError('Chưa đăng nhập', 401));

    const { result } = renderHook(() => useUnreadNotificationCount({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
  });
});
