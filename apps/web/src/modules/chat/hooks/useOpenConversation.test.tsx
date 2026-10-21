import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { CONVERSATION_ID, SHOP_ID, makeSummary } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { seededConversationQueryKey } from './chat-query-keys';
import { useOpenConversation, useSeededConversation } from './useOpenConversation';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const openConversationMock = vi.mocked(chatService.openConversation);

describe('useOpenConversation / useSeededConversation', () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('mở hội thoại: gọi API với shopId, ghi bản tóm tắt vào cache để đọc lại, trả về bản tóm tắt', async () => {
    const summary = makeSummary({ lastMessage: null, lastMessageAt: null });
    openConversationMock.mockResolvedValue(summary);
    const { result } = renderHook(
      () => ({ open: useOpenConversation(), seeded: useSeededConversation(BUYER, summary.id) }),
      { wrapper },
    );
    expect(result.current.seeded).toBeUndefined();

    act(() => result.current.open.mutate(SHOP_ID));

    await waitFor(() => expect(result.current.seeded).toEqual(summary));
    expect(openConversationMock).toHaveBeenCalledWith(SHOP_ID);
    expect(result.current.open.data).toEqual(summary);
    expect(queryClient.getQueryData(seededConversationQueryKey(BUYER, summary.id))).toEqual(
      summary,
    );
  });

  it('useSeededConversation KHÔNG BAO GIỜ gọi mạng, kể cả khi chưa có gì trong cache', async () => {
    const { result } = renderHook(() => useSeededConversation(BUYER, CONVERSATION_ID), {
      wrapper,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBeUndefined();
    expect(openConversationMock).not.toHaveBeenCalled();
    expect(chatService.listConversations).not.toHaveBeenCalled();
  });

  it('conversationId null ⇒ undefined dù cache của id rỗng có gì', () => {
    queryClient.setQueryData(seededConversationQueryKey(BUYER, ''), makeSummary());
    const { result } = renderHook(() => useSeededConversation(BUYER, null), { wrapper });

    expect(result.current).toBeUndefined();
  });

  it.each([
    [409, 'CHAT_OWN_SHOP'],
    [429, 'CHAT_CONVERSATION_LIMIT'],
  ])(
    'lỗi %i %s: mutation báo lỗi mang code để nơi gọi dịch, cache không bị ghi',
    async (status, code) => {
      openConversationMock.mockRejectedValue(new ApiError('x', status, code));
      const { result } = renderHook(() => useOpenConversation(), { wrapper });

      act(() => result.current.mutate(SHOP_ID));

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toMatchObject({ status, code });
      expect(queryClient.getQueryCache().findAll({ queryKey: ['chat'] })).toHaveLength(0);
    },
  );
});
