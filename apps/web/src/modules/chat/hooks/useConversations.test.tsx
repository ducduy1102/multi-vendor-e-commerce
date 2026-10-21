import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONVERSATION_ID, OTHER_CONVERSATION_ID, makeSummary } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { useConversations } from './useConversations';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const listConversationsMock = vi.mocked(chatService.listConversations);

describe('useConversations', () => {
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    listConversationsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('nạp trang đầu, rồi fetchNextPage dùng con trỏ của trang trước', async () => {
    listConversationsMock
      .mockResolvedValueOnce({ items: [makeSummary({ id: CONVERSATION_ID })], nextCursor: 'c1' })
      .mockResolvedValueOnce({
        items: [makeSummary({ id: OTHER_CONVERSATION_ID })],
        nextCursor: null,
      });
    const { result } = renderHook(() => useConversations(BUYER), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((page) => page.items.map((i) => i.id))).toEqual([
        CONVERSATION_ID,
        OTHER_CONVERSATION_ID,
      ]),
    );
    expect(listConversationsMock).toHaveBeenNthCalledWith(1, BUYER, { before: undefined });
    expect(listConversationsMock).toHaveBeenNthCalledWith(2, BUYER, { before: 'c1' });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('enabled=false ⇒ không gọi API', async () => {
    renderHook(() => useConversations(BUYER, { enabled: false }), { wrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(listConversationsMock).not.toHaveBeenCalled();
  });
});
