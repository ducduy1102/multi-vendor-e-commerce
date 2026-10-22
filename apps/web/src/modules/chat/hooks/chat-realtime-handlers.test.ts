import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  OTHER_SHOP_ID,
  SHOP_ID,
  at,
  conversationsData,
  makeMessage,
  makeSummary,
  messagesData,
  uuid,
} from '../chat-test-data';
import { resetChatOutbox, useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatMessageEvent, ChatScope, UnreadCount } from '../types';
import type { ConversationsData, MessagesData } from './chat-cache';
import {
  applyServerMessage,
  handleIncomingMessage,
  handleReadReceipt,
  matchesScope,
} from './chat-realtime-handlers';
import {
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  unreadCountQueryKey,
} from './chat-query-keys';

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };

const event = (
  overrides: Partial<ChatMessageEvent> & { message?: ReturnType<typeof makeMessage> } = {},
): ChatMessageEvent => ({
  message: makeMessage({ senderRole: 'SHOP', createdAt: at(10) }),
  viewerRole: 'BUYER',
  shopId: SHOP_ID,
  ...overrides,
});

let queryClient: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  resetChatOutbox();
});

afterEach(() => {
  vi.useRealTimers();
});

const keysInvalidated = () =>
  invalidate.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

describe('matchesScope', () => {
  it('người mua chỉ nhận sự kiện có viewerRole BUYER', () => {
    expect(matchesScope(BUYER, event({ viewerRole: 'BUYER' }))).toBe(true);
    expect(matchesScope(BUYER, event({ viewerRole: 'SHOP' }))).toBe(false);
  });

  it('chủ shop chỉ nhận sự kiện viewerRole SHOP của ĐÚNG shop (một người có thể sở hữu nhiều hộp thư)', () => {
    expect(matchesScope(SHOP, event({ viewerRole: 'SHOP', shopId: SHOP_ID }))).toBe(true);
    expect(matchesScope(SHOP, event({ viewerRole: 'SHOP', shopId: OTHER_SHOP_ID }))).toBe(false);
    expect(matchesScope(SHOP, event({ viewerRole: 'BUYER', shopId: SHOP_ID }))).toBe(false);
  });
});

describe('handleIncomingMessage', () => {
  it('sự kiện không thuộc phạm vi ⇒ không đụng gì', () => {
    queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    const before = queryClient.getQueryData(messagesQueryKey(BUYER, CONVERSATION_ID));

    handleIncomingMessage(queryClient, BUYER, event({ viewerRole: 'SHOP' }));
    vi.advanceTimersByTime(1000);

    expect(queryClient.getQueryData(messagesQueryKey(BUYER, CONVERSATION_ID))).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tin của đối phương: vào cache hội thoại, cập nhật dòng danh sách, làm mới huy hiệu (KHÔNG tự cộng +1)', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(1), createdAt: at(1) })]),
    );
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 0 })]),
    );
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 4 });

    handleIncomingMessage(
      queryClient,
      BUYER,
      event({ message: makeMessage({ id: uuid(2), senderRole: 'SHOP', createdAt: at(10) }) }),
    );

    const thread = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    const list = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(thread?.pages[0].items.map((m) => m.id)).toEqual([uuid(2), uuid(1)]);
    expect(list?.pages[0].items[0]).toMatchObject({ unreadCount: 1, lastMessageAt: at(10) });
    // huy hiệu: giữ nguyên số cũ ngay, rồi tải lại theo lô
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 4 });
    vi.advanceTimersByTime(250);
    expect(keysInvalidated()).toContain(JSON.stringify(unreadCountQueryKey(BUYER)));
  });

  it('hội thoại MỚI (chưa có dòng trong danh sách) ⇒ tải lại danh sách', () => {
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ id: OTHER_CONVERSATION_ID })]),
    );

    handleIncomingMessage(queryClient, BUYER, event());
    vi.advanceTimersByTime(250);

    expect(keysInvalidated()).toContain(JSON.stringify(conversationsQueryKey(BUYER)));
  });

  it('danh sách chưa nạp ⇒ không làm mới danh sách (lúc mở sẽ nạp mới)', () => {
    handleIncomingMessage(queryClient, BUYER, event());
    vi.advanceTimersByTime(250);

    expect(keysInvalidated()).not.toContain(JSON.stringify(conversationsQueryKey(BUYER)));
  });

  it('tin của CHÍNH MÌNH (tab khác gửi): không làm mới huy hiệu; chưa đọc của hội thoại đó được trừ khỏi huy hiệu', () => {
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 3 })]),
    );
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 5 });

    handleIncomingMessage(
      queryClient,
      BUYER,
      event({
        message: makeMessage({
          id: uuid(2),
          senderRole: 'BUYER',
          clientMessageId: uuid(50),
          createdAt: at(10),
        }),
      }),
    );
    vi.advanceTimersByTime(1000);

    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 2 });
    expect(keysInvalidated()).not.toContain(JSON.stringify(unreadCountQueryKey(BUYER)));
  });

  it('chủ shop: chỉ cập nhật cache của ĐÚNG shop', () => {
    queryClient.setQueryData(
      conversationsQueryKey(SHOP),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 0 })]),
    );
    queryClient.setQueryData(
      conversationsQueryKey({ role: 'SHOP', shopId: OTHER_SHOP_ID }),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 0 })]),
    );

    handleIncomingMessage(
      queryClient,
      SHOP,
      event({
        viewerRole: 'SHOP',
        shopId: SHOP_ID,
        message: makeMessage({ senderRole: 'BUYER', createdAt: at(10) }),
      }),
    );

    const mine = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(SHOP));
    const other = queryClient.getQueryData<ConversationsData>(
      conversationsQueryKey({ role: 'SHOP', shopId: OTHER_SHOP_ID }),
    );
    expect(mine?.pages[0].items[0].unreadCount).toBe(1);
    expect(other?.pages[0].items[0].unreadCount).toBe(0);
  });

  it('phản hồi của tin MÌNH gửi tới muộn, sau khi tin trả lời mới hơn của đối phương đã vào danh sách ⇒ KHÔNG trừ chưa đọc của tin trả lời khỏi huy hiệu', () => {
    // Mình gửi A (at 5); đối phương trả lời B (at 10) → danh sách: chưa đọc 1, huy hiệu 1. Rồi phản hồi HTTP của A mới về.
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(10), unreadCount: 1 })]),
    );
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 1 });

    applyServerMessage(
      queryClient,
      BUYER,
      makeMessage({
        id: uuid(3),
        senderRole: 'BUYER',
        clientMessageId: uuid(50),
        createdAt: at(5),
      }),
    );

    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 1 });
    const list = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(list?.pages[0].items[0]).toMatchObject({ unreadCount: 1, lastMessageAt: at(10) });
  });

  it('tin chung một lúc đến hai lần (sự kiện lặp) không làm chưa đọc +2', () => {
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 0 })]),
    );
    const incoming = event();

    handleIncomingMessage(queryClient, BUYER, incoming);
    handleIncomingMessage(queryClient, BUYER, incoming);

    const list = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(list?.pages[0].items[0].unreadCount).toBe(1);
  });
});

describe('applyServerMessage — gỡ tin tạm khỏi hộp chờ', () => {
  const pending = (clientMessageId: string) => ({
    clientMessageId,
    conversationId: CONVERSATION_ID,
    senderRole: 'BUYER' as const,
    content: 'đang gửi',
    createdAt: at(0),
  });

  it('tin của chính mình mang clientMessageId ⇒ gỡ đúng bản tạm đó, kể cả khi hội thoại chưa nạp cache', () => {
    useChatOutboxStore.getState().enqueue(pending(uuid(50)));
    useChatOutboxStore.getState().enqueue(pending(uuid(51)));

    applyServerMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'BUYER', clientMessageId: uuid(50) }),
    );

    expect(
      useChatOutboxStore.getState().byConversation[CONVERSATION_ID]?.map((i) => i.clientMessageId),
    ).toEqual([uuid(51)]);
  });

  it('tin của đối phương (không có clientMessageId) không đụng tới hộp chờ', () => {
    useChatOutboxStore.getState().enqueue(pending(uuid(50)));

    applyServerMessage(queryClient, BUYER, makeMessage({ senderRole: 'SHOP' }));

    expect(useChatOutboxStore.getState().byConversation[CONVERSATION_ID]).toHaveLength(1);
  });

  it('chạy hai lần (sự kiện + phản hồi HTTP của cùng tin) vẫn đúng và không lỗi', () => {
    useChatOutboxStore.getState().enqueue(pending(uuid(50)));
    queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    const message = makeMessage({
      id: uuid(9),
      senderRole: 'BUYER',
      clientMessageId: uuid(50),
      createdAt: at(5),
    });

    applyServerMessage(queryClient, BUYER, message);
    applyServerMessage(queryClient, BUYER, message);

    const thread = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    expect(thread?.pages[0].items.map((m) => m.id)).toEqual([uuid(9)]);
    expect(useChatOutboxStore.getState().byConversation).toEqual({});
  });
});

describe('handleReadReceipt', () => {
  it('ghi mốc đối phương đã đọc, chỉ tăng', () => {
    handleReadReceipt(queryClient, { conversationId: CONVERSATION_ID, readAt: at(7) });
    handleReadReceipt(queryClient, { conversationId: CONVERSATION_ID, readAt: at(2) });

    expect(queryClient.getQueryData(otherReadMarkQueryKey(CONVERSATION_ID))).toBe(at(7));
  });
});
