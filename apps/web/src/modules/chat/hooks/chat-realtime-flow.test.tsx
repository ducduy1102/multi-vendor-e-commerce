import { REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONVERSATION_ID, SHOP_ID, at, makeMessage, makeSummary, uuid } from '../chat-test-data';
import {
  createChatHarness,
  resetChatHarnessAuth,
  type ChatTestHarness,
} from '../chat-test-wrapper';
import * as chatService from '../services/chat.service';
import { resetChatOutbox, useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatMessage, ChatScope } from '../types';
import type { MessagesData } from './chat-cache';
import { isPendingMessage } from './chat-messages';
import { messagesQueryKey } from './chat-query-keys';
import { useChatRealtimeSync } from './useChatRealtimeSync';
import { useChatUnreadCount } from './useChatUnreadCount';
import { useConversations } from './useConversations';
import { useMessages } from './useMessages';
import { useSendMessage } from './useSendMessage';

vi.mock('../services/chat.service');

// Kiểm các hook GHÉP VỚI NHAU qua socket giả (Week10.md 5.6): từng hook đã có test riêng, ở đây kiểm đúng chỗ dễ vỡ khi
// chúng chạy cùng một lúc — sự kiện real-time và phản hồi HTTP của cùng một tin, và lấp khoảng trống sau khi nối lại.
const BUYER: ChatScope = { role: 'BUYER' };
const listMessages = vi.mocked(chatService.listMessages);
const listConversations = vi.mocked(chatService.listConversations);
const getUnreadCount = vi.mocked(chatService.getUnreadCount);
const sendMessage = vi.mocked(chatService.sendMessage);

function useChatFlow() {
  useChatRealtimeSync(BUYER);
  return {
    messages: useMessages(BUYER, CONVERSATION_ID),
    send: useSendMessage(BUYER, CONVERSATION_ID),
    conversations: useConversations(BUYER),
    unread: useChatUnreadCount(BUYER, { enabled: true }),
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);
const outboxSize = () => Object.keys(useChatOutboxStore.getState().byConversation).length;
// Khẳng định thẳng vào CACHE (đồng bộ): danh sách hiển thị tự khử trùng theo id nên nếu chỉ nhìn `items` thì lỗi khử
// trùng ở bước chèn vào cache bị che mất.
const cachedIds = (queryClient: { getQueryData: <T>(key: readonly unknown[]) => T | undefined }) =>
  queryClient
    .getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID))
    ?.pages.flatMap((page) => page.items.map((item) => item.id));
// TanStack Query báo thay đổi cache cho component qua hàng đợi bất đồng bộ: assert đồng bộ ngay sau `act` đọc trúng dữ
// liệu CŨ và xanh giả. Trước khi khẳng định "KHÔNG có gì đổi" phải chờ hàng đợi đó chạy xong.
const flushNotifications = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe('luồng chat ghép các hook với real-time giả', () => {
  let h: ChatTestHarness;

  beforeEach(() => {
    h = createChatHarness();
    resetChatOutbox();
    listMessages.mockReset().mockResolvedValue({
      items: [makeMessage({ id: uuid(1), senderRole: 'SHOP', createdAt: at(1) })],
      nextCursor: null,
    });
    listConversations.mockReset().mockResolvedValue({
      items: [makeSummary({ lastMessageAt: at(1), unreadCount: 0 })],
      nextCursor: null,
    });
    getUnreadCount.mockReset().mockResolvedValue({ unreadCount: 0 });
    sendMessage.mockReset();
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset store: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    resetChatHarnessAuth();
    vi.useRealTimers();
  });

  const mount = async () => {
    const hook = renderHook(() => useChatFlow(), { wrapper: h.wrapper });
    await h.connect();
    await waitFor(() => expect(hook.result.current.messages.isPending).toBe(false));
    await waitFor(() => expect(hook.result.current.conversations.data).toBeDefined());
    return hook;
  };

  it('sự kiện real-time của tin MÌNH vừa gửi tới TRƯỚC phản hồi HTTP ⇒ đúng MỘT bản, không còn bản tạm', async () => {
    let resolveSend!: (message: ChatMessage) => void;
    sendMessage.mockReturnValue(
      new Promise<ChatMessage>((resolve) => {
        resolveSend = resolve;
      }),
    );
    const { result } = await mount();

    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send.send('xin chào');
    });
    await waitFor(() => expect(result.current.messages.items.some(isPendingMessage)).toBe(true));

    const serverMessage = makeMessage({
      id: uuid(9),
      senderRole: 'BUYER',
      content: 'xin chào',
      clientMessageId,
      createdAt: at(5),
    });
    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
        message: serverMessage,
        viewerRole: 'BUYER',
        shopId: SHOP_ID,
      }),
    );
    await waitFor(() => expect(result.current.messages.items.some(isPendingMessage)).toBe(false));
    expect(ids(result.current.messages.items)).toEqual([uuid(9), uuid(1)]);
    // Bản tạm đã được GỠ khỏi hộp chờ ngay khi sự kiện tới (không đợi phản hồi HTTP).
    expect(outboxSize()).toBe(0);
    expect(cachedIds(h.queryClient)).toEqual([uuid(9), uuid(1)]);

    await act(async () => {
      resolveSend(serverMessage);
    });
    await flushNotifications();

    expect(ids(result.current.messages.items)).toEqual([uuid(9), uuid(1)]);
    expect(cachedIds(h.queryClient)).toEqual([uuid(9), uuid(1)]); // vẫn đúng MỘT bản trong cache
    expect(outboxSize()).toBe(0);
    // TanStack Query báo trạng thái mutation cho component qua hàng đợi bất đồng bộ nên phải chờ.
    await waitFor(() => expect(result.current.send.isSending).toBe(false));
  });

  it('phản hồi HTTP tới TRƯỚC sự kiện real-time ⇒ vẫn đúng một bản khi sự kiện đến sau', async () => {
    sendMessage.mockImplementation((_scope, _id, body) =>
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
    const { result } = await mount();

    let clientMessageId = '';
    act(() => {
      clientMessageId = result.current.send.send('xin chào');
    });
    await waitFor(() => expect(ids(result.current.messages.items)).toEqual([uuid(9), uuid(1)]));
    expect(cachedIds(h.queryClient)).toEqual([uuid(9), uuid(1)]);

    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
        message: makeMessage({
          id: uuid(9),
          senderRole: 'BUYER',
          content: 'xin chào',
          clientMessageId,
          createdAt: at(5),
        }),
        viewerRole: 'BUYER',
        shopId: SHOP_ID,
      }),
    );
    await flushNotifications();

    expect(ids(result.current.messages.items)).toEqual([uuid(9), uuid(1)]);
    expect(cachedIds(h.queryClient)).toEqual([uuid(9), uuid(1)]); // sự kiện muộn KHÔNG nhân đôi tin trong cache
  });

  it('tin của đối phương tới qua real-time: vào khung tin, đẩy dòng danh sách lên, huy hiệu tải lại về đúng số của server', async () => {
    const { result } = await mount();
    getUnreadCount.mockResolvedValue({ unreadCount: 1 });

    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
        message: makeMessage({
          id: uuid(20),
          senderRole: 'SHOP',
          content: 'Còn hàng nhé',
          createdAt: at(30),
        }),
        viewerRole: 'BUYER',
        shopId: SHOP_ID,
      }),
    );

    await waitFor(() => expect(ids(result.current.messages.items)).toEqual([uuid(20), uuid(1)]));
    const first = result.current.conversations.data?.pages[0].items[0];
    expect(first).toMatchObject({ lastMessageAt: at(30), unreadCount: 1 });
    expect(first?.lastMessage?.content).toBe('Còn hàng nhé');
    // Huy hiệu KHÔNG tự +1 mà tải lại từ server (gộp lô 250 ms).
    await waitFor(() => expect(result.current.unread.data).toBe(1), { timeout: 3000 });
  });

  it('sự kiện của hội thoại/vai khác không đụng tới khung tin đang mở', async () => {
    const { result } = await mount();

    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
        message: makeMessage({ id: uuid(21), senderRole: 'BUYER', createdAt: at(40) }),
        viewerRole: 'SHOP', // vai khác: thuộc hộp thư của shop, không phải hộp thư người mua này
        shopId: SHOP_ID,
      }),
    );

    await flushNotifications();

    expect(ids(result.current.messages.items)).toEqual([uuid(1)]);
    expect(cachedIds(h.queryClient)).toEqual([uuid(1)]); // không lọt vào cache của hộp thư người mua
    expect(result.current.conversations.data?.pages[0].items[0].lastMessageAt).toBe(at(1));
  });

  it('rớt kết nối rồi nối lại ⇒ LẤP KHOẢNG TRỐNG: tin bỏ lỡ lúc mất kết nối được tải về, danh sách và huy hiệu cũng làm mới', async () => {
    const { result } = await mount();
    expect(ids(result.current.messages.items)).toEqual([uuid(1)]);
    const callsBefore = {
      messages: listMessages.mock.calls.length,
      conversations: listConversations.mock.calls.length,
      unread: getUnreadCount.mock.calls.length,
    };

    // Lúc mất kết nối server có thêm một tin mà client KHÔNG nhận được sự kiện nào.
    listMessages.mockResolvedValue({
      items: [
        makeMessage({ id: uuid(30), senderRole: 'SHOP', content: 'tin bị lỡ', createdAt: at(50) }),
        makeMessage({ id: uuid(1), senderRole: 'SHOP', createdAt: at(1) }),
      ],
      nextCursor: null,
    });
    listConversations.mockResolvedValue({
      items: [makeSummary({ lastMessageAt: at(50), unreadCount: 1 })],
      nextCursor: null,
    });
    getUnreadCount.mockResolvedValue({ unreadCount: 1 });

    vi.useFakeTimers();
    try {
      act(() => h.socket.serverDisconnects('transport close'));
      act(() => {
        vi.advanceTimersByTime(60_000); // hết backoff: client dựng lại kết nối
      });
    } finally {
      vi.useRealTimers();
    }
    await h.settle();
    act(() => h.socket.serverConnects());

    await waitFor(() => expect(ids(result.current.messages.items)).toEqual([uuid(30), uuid(1)]));
    await waitFor(() => expect(result.current.unread.data).toBe(1));
    expect(listMessages.mock.calls.length).toBeGreaterThan(callsBefore.messages);
    expect(listConversations.mock.calls.length).toBeGreaterThan(callsBefore.conversations);
    expect(getUnreadCount.mock.calls.length).toBeGreaterThan(callsBefore.unread);
    expect(result.current.conversations.data?.pages[0].items[0].lastMessageAt).toBe(at(50));
  });

  it('MOUNT TRỄ: hook đồng bộ (nạp động) bắt đầu nghe SAU khi socket đã nối và tin đã phát trong khoảng đó ⇒ huy hiệu vẫn được đối soát', async () => {
    // MỘT Provider duy nhất cho cả hai phần (mỗi `renderHook` tạo Provider riêng nên không dùng được ở đây): huy hiệu mount
    // sẵn (như biểu tượng tin nhắn ở Header), còn component đồng bộ chỉ được dựng SAU, đúng như `React.lazy` ở lazy-chat.
    function LateSync() {
      useChatRealtimeSync(BUYER);
      return null;
    }
    function Page({ showSync }: { showSync: boolean }) {
      const unread = useChatUnreadCount(BUYER, { enabled: true });
      return (
        <>
          <output data-testid="badge">{unread.data ?? ''}</output>
          {showSync ? <LateSync /> : null}
        </>
      );
    }
    const badge = () => screen.getByTestId('badge').textContent;
    const view = render(<Page showSync={false} />, { wrapper: h.wrapper });
    await h.connect();
    await waitFor(() => expect(badge()).toBe('0'));
    const callsBefore = getUnreadCount.mock.calls.length;

    // Server phát một tin cho người mua LÚC CHƯA AI NGHE: sự kiện này bị lỡ, và số chưa đọc ở server giờ là 1.
    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
        message: makeMessage({ id: uuid(40), senderRole: 'SHOP', createdAt: at(60) }),
        viewerRole: 'BUYER',
        shopId: SHOP_ID,
      }),
    );
    getUnreadCount.mockResolvedValue({ unreadCount: 1 });
    await h.settle();
    expect(badge()).toBe('0'); // đúng như lỗi thật: huy hiệu cũ, không có gì làm mới

    // Chunk đồng bộ về trễ và mount khi socket ĐÃ nối: phải tự đối soát chứ không chờ sự kiện kế tiếp.
    view.rerender(<Page showSync />);

    await waitFor(() => expect(badge()).toBe('1'));
    expect(getUnreadCount.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
