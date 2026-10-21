import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { CONVERSATION_ID, SHOP_ID, at, makeMessage, uuid } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import { resetChatOutbox, useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatScope } from '../types';
import { isPendingMessage } from './chat-messages';
import { messagesQueryKey } from './chat-query-keys';
import { upsertServerMessage } from './chat-cache';
import { useMessages } from './useMessages';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };
const listMessagesMock = vi.mocked(chatService.listMessages);

describe('useMessages', () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    resetChatOutbox();
    listMessagesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('chưa chọn hội thoại (null) ⇒ không gọi API, không ở trạng thái lỗi', async () => {
    const { result } = renderHook(() => useMessages(BUYER, null), { wrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(listMessagesMock).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('nạp trang đầu (không có con trỏ) theo đúng phạm vi và hội thoại', async () => {
    listMessagesMock.mockResolvedValue({
      items: [makeMessage({ id: uuid(2), createdAt: at(2) }), makeMessage({ id: uuid(1) })],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages(SHOP, CONVERSATION_ID), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(listMessagesMock).toHaveBeenCalledWith(SHOP, CONVERSATION_ID, { before: undefined });
    expect(result.current.items.map((m) => m.id)).toEqual([uuid(2), uuid(1)]);
    expect(result.current.hasOlder).toBe(false);
  });

  it('fetchOlder tải trang cũ hơn bằng con trỏ của trang trước và nối vào CUỐI (cũ hơn)', async () => {
    listMessagesMock
      .mockResolvedValueOnce({
        items: [makeMessage({ id: uuid(3), createdAt: at(3) })],
        nextCursor: 'cursor-a',
      })
      .mockResolvedValueOnce({
        items: [makeMessage({ id: uuid(2), createdAt: at(2) })],
        nextCursor: null,
      });
    const { result } = renderHook(() => useMessages(BUYER, CONVERSATION_ID), { wrapper });
    await waitFor(() => expect(result.current.hasOlder).toBe(true));

    act(() => result.current.fetchOlder());

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(listMessagesMock).toHaveBeenLastCalledWith(BUYER, CONVERSATION_ID, {
      before: 'cursor-a',
    });
    expect(result.current.items.map((m) => m.id)).toEqual([uuid(3), uuid(2)]);
    expect(result.current.hasOlder).toBe(false);
  });

  it('tin đang gửi / gửi lỗi nằm TRÊN CÙNG; hết khi server có bản cùng clientMessageId', async () => {
    listMessagesMock.mockResolvedValue({
      items: [makeMessage({ id: uuid(1), createdAt: at(1) })],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages(BUYER, CONVERSATION_ID), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    act(() => {
      useChatOutboxStore.getState().enqueue({
        clientMessageId: uuid(50),
        conversationId: CONVERSATION_ID,
        senderRole: 'BUYER',
        content: 'đang gửi',
        createdAt: at(99),
      });
    });
    expect(result.current.items.map((m) => m.content)).toEqual(['đang gửi', 'xin chào']);
    expect(isPendingMessage(result.current.items[0])).toBe(true);

    // Server nhận tin (qua real-time) trước khi hộp chờ kịp dọn: bản tạm phải ẩn, không hiện đôi.
    act(() => {
      upsertServerMessage(
        queryClient,
        BUYER,
        makeMessage({
          id: uuid(2),
          senderRole: 'BUYER',
          content: 'đang gửi',
          clientMessageId: uuid(50),
          createdAt: at(5),
        }),
      );
    });
    // TanStack Query báo thay đổi cache cho component qua hàng đợi bất đồng bộ nên phải chờ.
    await waitFor(() => expect(result.current.items.map((m) => m.id)).toEqual([uuid(2), uuid(1)]));
  });

  it('hộp chờ của hội thoại KHÁC không lẫn vào', async () => {
    listMessagesMock.mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useMessages(BUYER, CONVERSATION_ID), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    act(() => {
      useChatOutboxStore.getState().enqueue({
        clientMessageId: uuid(50),
        conversationId: uuid(777),
        senderRole: 'BUYER',
        content: 'của hội thoại khác',
        createdAt: at(1),
      });
    });

    expect(result.current.items).toEqual([]);
  });

  it('tin vẫn còn trong hộp chờ khi tải lại trang đầu (refetch) — không mất tin "gửi lỗi"', async () => {
    listMessagesMock.mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useMessages(BUYER, CONVERSATION_ID), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    act(() => {
      useChatOutboxStore.getState().enqueue({
        clientMessageId: uuid(50),
        conversationId: CONVERSATION_ID,
        senderRole: 'BUYER',
        content: 'giữ lại',
        createdAt: at(1),
      });
      useChatOutboxStore.getState().markFailed(CONVERSATION_ID, uuid(50), { status: 0 });
    });

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: messagesQueryKey(BUYER, CONVERSATION_ID) });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ content: 'giữ lại', deliveryStatus: 'failed' });
  });

  it('lỗi 4xx ⇒ isError, không thử lại; refetch thử lại được', async () => {
    listMessagesMock.mockRejectedValueOnce(new ApiError('Không phải của bạn', 403));
    const { result } = renderHook(() => useMessages(BUYER, CONVERSATION_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listMessagesMock).toHaveBeenCalledTimes(1);

    listMessagesMock.mockResolvedValueOnce({
      items: [makeMessage({ id: uuid(1) })],
      nextCursor: null,
    });
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.items).toHaveLength(1);
  });

  it('phạm vi viết inline mỗi lần render không làm đổi cache hay gọi API lại', async () => {
    listMessagesMock.mockResolvedValue({ items: [makeMessage()], nextCursor: null });
    const { result, rerender } = renderHook(
      () => useMessages({ role: 'SHOP', shopId: SHOP_ID }, CONVERSATION_ID),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));

    rerender();
    rerender();

    expect(listMessagesMock).toHaveBeenCalledTimes(1);
  });
});
