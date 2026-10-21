import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { SHOP_ID } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { useChatUnreadCount } from './useChatUnreadCount';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };
const getUnreadCountMock = vi.mocked(chatService.getUnreadCount);

describe('useChatUnreadCount', () => {
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

  it('trả về MỘT SỐ (không phải object) của đúng phạm vi', async () => {
    getUnreadCountMock.mockResolvedValue({ unreadCount: 7 });
    const { result } = renderHook(() => useChatUnreadCount(SHOP, { enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(7));
    expect(getUnreadCountMock).toHaveBeenCalledWith(SHOP);
  });

  it('enabled=false (khách vãng lai) ⇒ KHÔNG gọi API', async () => {
    const { result } = renderHook(() => useChatUnreadCount(BUYER, { enabled: false }), {
      wrapper,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getUnreadCountMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('lỗi 401 không thử lại', async () => {
    getUnreadCountMock.mockRejectedValue(new ApiError('Chưa đăng nhập', 401));
    const { result } = renderHook(() => useChatUnreadCount(BUYER, { enabled: true }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
  });
});
