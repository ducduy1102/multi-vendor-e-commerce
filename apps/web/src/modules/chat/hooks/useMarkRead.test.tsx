import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import {
  CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  SHOP_ID,
  at,
  conversationsData,
  makeSummary,
} from '../chat-test-data';
import * as chatService from '../services/chat.service';
import type { ChatScope, UnreadCount } from '../types';
import type { ConversationsData } from './chat-cache';
import { conversationsQueryKey, unreadCountQueryKey } from './chat-query-keys';
import { useMarkRead } from './useMarkRead';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };
const markReadMock = vi.mocked(chatService.markRead);

describe('useMarkRead', () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  const seed = (scope: ChatScope) => {
    queryClient.setQueryData(
      conversationsQueryKey(scope),
      conversationsData([
        makeSummary({ id: CONVERSATION_ID, unreadCount: 3 }),
        makeSummary({ id: OTHER_CONVERSATION_ID, unreadCount: 2 }),
      ]),
    );
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(scope), { unreadCount: 5 });
  };
  const unreadOf = (scope: ChatScope, id: string) =>
    queryClient
      .getQueryData<ConversationsData>(conversationsQueryKey(scope))
      ?.pages[0].items.find((item) => item.id === id)?.unreadCount;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    markReadMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('LẠC QUAN: số chưa đọc của hội thoại về 0 và huy hiệu tổng giảm đúng phần đó NGAY, trước khi API trả lời', async () => {
    markReadMock.mockReturnValue(new Promise(() => {}));
    seed(BUYER);
    const { result } = renderHook(() => useMarkRead(BUYER), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));

    await waitFor(() => expect(unreadOf(BUYER, CONVERSATION_ID)).toBe(0));
    expect(unreadOf(BUYER, OTHER_CONVERSATION_ID)).toBe(2);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 2 });
    expect(markReadMock).toHaveBeenCalledWith(BUYER, CONVERSATION_ID);
  });

  it('hội thoại không có tin chưa đọc ⇒ huy hiệu giữ nguyên (không trừ nhầm)', async () => {
    markReadMock.mockResolvedValue({ readAt: at(1) });
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ unreadCount: 0 })]),
    );
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 4 });
    const { result } = renderHook(() => useMarkRead(BUYER), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 4 });
  });

  it('danh sách chưa nạp ⇒ không tạo cache giả, vẫn gọi API', async () => {
    markReadMock.mockResolvedValue({ readAt: at(1) });
    const { result } = renderHook(() => useMarkRead(BUYER), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(conversationsQueryKey(BUYER))).toBeUndefined();
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toBeUndefined();
    expect(markReadMock).toHaveBeenCalledTimes(1);
  });

  it('chủ shop: chỉ đụng cache của ĐÚNG shop, gọi API theo phạm vi shop', async () => {
    markReadMock.mockResolvedValue({ readAt: at(1) });
    seed(SHOP);
    seed(BUYER);
    const { result } = renderHook(() => useMarkRead(SHOP), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(unreadOf(SHOP, CONVERSATION_ID)).toBe(0);
    expect(unreadOf(BUYER, CONVERSATION_ID)).toBe(3);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 5 });
    expect(markReadMock).toHaveBeenCalledWith(SHOP, CONVERSATION_ID);
  });

  it('LỖI ⇒ tải lại danh sách + huy hiệu để lấy số đúng của server', async () => {
    markReadMock.mockRejectedValue(new ApiError('Lỗi', 500));
    seed(BUYER);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMarkRead(BUYER), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));
    await waitFor(() => expect(result.current.isError).toBe(true));

    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(conversationsQueryKey(BUYER));
    expect(keys).toContainEqual(unreadCountQueryKey(BUYER));
  });

  it('thành công ⇒ KHÔNG tải lại gì (server idempotent, số lạc quan đã đúng)', async () => {
    markReadMock.mockResolvedValue({ readAt: at(1) });
    seed(BUYER);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMarkRead(BUYER), { wrapper });

    act(() => result.current.mutate(CONVERSATION_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
