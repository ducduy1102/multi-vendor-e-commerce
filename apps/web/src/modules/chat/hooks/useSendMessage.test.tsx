import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import {
  CONVERSATION_ID,
  SHOP_ID,
  at,
  conversationsData,
  makeMessage,
  makeSummary,
  messagesData,
  uuid,
} from '../chat-test-data';
import * as chatService from '../services/chat.service';
import { resetChatOutbox, useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatMessage, ChatScope } from '../types';
import type { ConversationsData, MessagesData } from './chat-cache';
import { conversationsQueryKey, messagesQueryKey } from './chat-query-keys';
import { applyServerMessage } from './chat-realtime-handlers';
import { useSendMessage } from './useSendMessage';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };
const sendMessageMock = vi.mocked(chatService.sendMessage);

const outboxItems = () => useChatOutboxStore.getState().byConversation[CONVERSATION_ID] ?? [];

// Lời hứa có thể giải quyết tay: dựng đúng khoảnh khắc "yêu cầu đang bay".
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSendMessage', () => {
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
    sendMessageMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
  });

  it('send: tin hiện NGAY trong hộp chờ ở trạng thái "đang gửi", rồi gọi API với đúng phạm vi + khoá', async () => {
    const pending = deferred<ChatMessage>();
    sendMessageMock.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('xin chào');
    });

    expect(outboxItems()).toMatchObject([
      {
        clientMessageId,
        conversationId: CONVERSATION_ID,
        senderRole: 'BUYER',
        content: 'xin chào',
        deliveryStatus: 'sending',
      },
    ]);
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(BUYER, CONVERSATION_ID, {
      content: 'xin chào',
      clientMessageId,
    });
    expect(clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(result.current.isSending).toBe(true));
  });

  it('mỗi tin có clientMessageId riêng', () => {
    sendMessageMock.mockReturnValue(deferred<ChatMessage>().promise);
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    let first = '';
    let second = '';
    act(() => {
      first = result.current.send('một');
      second = result.current.send('hai');
    });

    expect(first).not.toBe(second);
    expect(outboxItems().map((i) => i.clientMessageId)).toEqual([second, first]);
  });

  it('chủ shop gửi: tin tạm mang vai SHOP và gọi API theo phạm vi shop', async () => {
    sendMessageMock.mockReturnValue(deferred<ChatMessage>().promise);
    const { result } = renderHook(() => useSendMessage(SHOP, CONVERSATION_ID), { wrapper });

    act(() => {
      result.current.send('chào bạn');
    });

    expect(outboxItems()[0].senderRole).toBe('SHOP');
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(sendMessageMock.mock.calls[0][0]).toEqual(SHOP);
  });

  it('thành công: bản tạm được gỡ, tin thật vào cache hội thoại và đẩy dòng danh sách lên với số chưa đọc 0', async () => {
    queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 2 })]),
    );
    sendMessageMock.mockImplementation((_scope, _id, body) =>
      Promise.resolve(
        makeMessage({
          id: uuid(7),
          senderRole: 'BUYER',
          content: body.content,
          clientMessageId: body.clientMessageId,
          createdAt: at(10),
        }),
      ),
    );
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    act(() => {
      result.current.send('xin chào');
    });

    await waitFor(() => expect(outboxItems()).toHaveLength(0));
    const thread = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    const list = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(thread?.pages[0].items.map((m) => m.id)).toEqual([uuid(7)]);
    expect(list?.pages[0].items[0]).toMatchObject({ unreadCount: 0, lastMessageAt: at(10) });
    expect(result.current.isSending).toBe(false);
  });

  it('thất bại: tin chuyển "gửi lỗi", GIỮ nội dung và clientMessageId, kèm status + code của server', async () => {
    sendMessageMock.mockRejectedValue(new ApiError('Hãy chờ', 429, 'CHAT_AWAITING_REPLY'));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('tin thứ ba');
    });

    await waitFor(() => expect(outboxItems()[0].deliveryStatus).toBe('failed'));
    expect(outboxItems()[0]).toMatchObject({
      clientMessageId,
      content: 'tin thứ ba',
      failure: { status: 429, code: 'CHAT_AWAITING_REPLY' },
    });
  });

  it('lỗi không phải ApiError (mất mạng) ⇒ failure { status: 0 }, không có code', async () => {
    sendMessageMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    act(() => {
      result.current.send('x');
    });

    await waitFor(() => expect(outboxItems()[0].deliveryStatus).toBe('failed'));
    expect(outboxItems()[0].failure).toEqual({ status: 0 });
  });

  it('trình duyệt báo MẤT MẠNG (navigator.onLine = false) ⇒ vẫn gọi API ngay và chuyển "gửi lỗi", không treo ở "đang gửi"', async () => {
    onlineManager.setOnline(false);
    sendMessageMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });

    act(() => {
      result.current.send('lúc mất mạng');
    });

    await waitFor(() => expect(outboxItems()[0].deliveryStatus).toBe('failed'));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(outboxItems()[0].failure).toEqual({ status: 0 });
    await waitFor(() => expect(result.current.isSending).toBe(false));
  });

  it('retry: gửi lại ĐÚNG clientMessageId + nội dung cũ, không tạo tin thứ hai; thành công thì gỡ bản tạm', async () => {
    sendMessageMock.mockRejectedValueOnce(new ApiError('Lỗi', 500));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('thử lại nhé');
    });
    await waitFor(() => expect(outboxItems()[0].deliveryStatus).toBe('failed'));

    sendMessageMock.mockImplementationOnce((_scope, _id, body) =>
      Promise.resolve(
        makeMessage({
          id: uuid(8),
          senderRole: 'BUYER',
          content: body.content,
          clientMessageId: body.clientMessageId,
        }),
      ),
    );
    act(() => result.current.retry(clientMessageId));

    // Ngay khi bấm thử lại, tin về "đang gửi" và lý do lỗi cũ biến mất.
    expect(outboxItems()).toHaveLength(1);
    await waitFor(() => expect(outboxItems()).toHaveLength(0));
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[1]).toEqual([
      BUYER,
      CONVERSATION_ID,
      { content: 'thử lại nhé', clientMessageId },
    ]);
    expect(sendMessageMock.mock.calls[0][2].clientMessageId).toBe(clientMessageId);
  });

  it('retry mà vẫn lỗi ⇒ quay lại "gửi lỗi" với lý do MỚI', async () => {
    sendMessageMock.mockRejectedValueOnce(new ApiError('Lỗi', 500));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('x');
    });
    await waitFor(() => expect(outboxItems()[0].failure).toEqual({ status: 500 }));

    sendMessageMock.mockRejectedValueOnce(new ApiError('Chờ đã', 429, 'CHAT_RATE_LIMITED'));
    act(() => result.current.retry(clientMessageId));

    await waitFor(() =>
      expect(outboxItems()[0].failure).toEqual({ status: 429, code: 'CHAT_RATE_LIMITED' }),
    );
    expect(outboxItems()[0].deliveryStatus).toBe('failed');
  });

  it('retry với tin ĐANG GỬI hoặc id không tồn tại ⇒ không gọi API thêm', async () => {
    sendMessageMock.mockReturnValue(deferred<ChatMessage>().promise);
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('x');
    });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.retry(clientMessageId);
      result.current.retry(uuid(999));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(outboxItems()[0].deliveryStatus).toBe('sending');
  });

  it('discard: bỏ tin gửi lỗi khỏi hộp chờ', async () => {
    sendMessageMock.mockRejectedValue(new ApiError('Lỗi', 500));
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('x');
    });
    await waitFor(() => expect(outboxItems()[0].deliveryStatus).toBe('failed'));

    act(() => result.current.discard(clientMessageId));

    expect(outboxItems()).toHaveLength(0);
  });

  it('sự kiện real-time của chính tin này tới TRƯỚC phản hồi HTTP ⇒ một bản duy nhất, hộp chờ sạch', async () => {
    queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    const pending = deferred<ChatMessage>();
    sendMessageMock.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('xin chào');
    });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    const serverMessage = makeMessage({
      id: uuid(9),
      senderRole: 'BUYER',
      content: 'xin chào',
      clientMessageId,
      createdAt: at(5),
    });

    // 1) sự kiện tới trước
    act(() => applyServerMessage(queryClient, BUYER, serverMessage));
    expect(outboxItems()).toHaveLength(0);
    // 2) rồi phản hồi HTTP của cùng tin
    await act(async () => {
      pending.resolve(serverMessage);
    });

    const thread = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    expect(thread?.pages[0].items).toHaveLength(1);
    expect(outboxItems()).toHaveLength(0);
  });

  it('phản hồi HTTP tới trước sự kiện real-time ⇒ vẫn một bản duy nhất', async () => {
    queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    sendMessageMock.mockImplementation((_scope, _id, body) =>
      Promise.resolve(
        makeMessage({
          id: uuid(9),
          senderRole: 'BUYER',
          content: body.content,
          clientMessageId: body.clientMessageId,
          createdAt: at(5),
        }),
      ),
    );
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), { wrapper });
    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send('xin chào');
    });
    await waitFor(() => expect(outboxItems()).toHaveLength(0));

    act(() =>
      applyServerMessage(
        queryClient,
        BUYER,
        makeMessage({ id: uuid(9), senderRole: 'BUYER', clientMessageId, createdAt: at(5) }),
      ),
    );

    const thread = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    expect(thread?.pages[0].items).toHaveLength(1);
  });

  it('StrictMode không gửi trùng: một lần bấm là đúng một lần gọi API', async () => {
    sendMessageMock.mockReturnValue(deferred<ChatMessage>().promise);
    const strictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useSendMessage(BUYER, CONVERSATION_ID), {
      wrapper: strictWrapper,
    });

    act(() => {
      result.current.send('x');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(outboxItems()).toHaveLength(1);
  });

  it('phạm vi viết inline mỗi lần render không làm `send` đổi identity', () => {
    const { result, rerender } = renderHook(
      () => useSendMessage({ role: 'SHOP', shopId: SHOP_ID }, CONVERSATION_ID),
      { wrapper },
    );
    const first = result.current;

    rerender();

    expect(result.current.send).toBe(first.send);
    expect(result.current.retry).toBe(first.retry);
    expect(result.current.discard).toBe(first.discard);
  });
});
