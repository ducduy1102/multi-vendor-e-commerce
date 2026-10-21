import { REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  CONVERSATION_ID,
  OTHER_SHOP_ID,
  SHOP_ID,
  at,
  conversationsData,
  makeMessage,
  makeSummary,
  messagesData,
  uuid,
} from '../chat-test-data';
import {
  createChatHarness,
  resetChatHarnessAuth,
  type ChatTestHarness,
} from '../chat-test-wrapper';
import { resetChatOutbox } from '../store/chat-outbox.store';
import type { ChatScope, UnreadCount } from '../types';
import type { ConversationsData, MessagesData } from './chat-cache';
import {
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  unreadCountQueryKey,
} from './chat-query-keys';
import { useChatRealtimeSync } from './useChatRealtimeSync';

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };

const messageEvent = (
  overrides: { viewerRole?: 'BUYER' | 'SHOP'; shopId?: string; senderRole?: 'BUYER' | 'SHOP' } = {},
) => ({
  message: makeMessage({
    id: uuid(20),
    senderRole: overrides.senderRole ?? 'SHOP',
    content: 'shop trả lời',
    createdAt: at(30),
  }),
  viewerRole: overrides.viewerRole ?? 'BUYER',
  shopId: overrides.shopId ?? SHOP_ID,
});

describe('useChatRealtimeSync', () => {
  let h: ChatTestHarness;

  beforeEach(() => {
    h = createChatHarness();
    resetChatOutbox();
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset store: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    resetChatHarnessAuth();
    vi.restoreAllMocks();
  });

  const seedBuyer = () => {
    h.queryClient.setQueryData(messagesQueryKey(BUYER, CONVERSATION_ID), messagesData([]));
    h.queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ lastMessageAt: at(1), unreadCount: 0 })]),
    );
    h.queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 0 });
  };

  describe('chat:message', () => {
    it('tin của đối phương vào cache hội thoại và dòng danh sách (chưa đọc +1)', async () => {
      seedBuyer();
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      act(() => h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent()));

      const thread = h.queryClient.getQueryData<MessagesData>(
        messagesQueryKey(BUYER, CONVERSATION_ID),
      );
      const list = h.queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
      expect(thread?.pages[0].items.map((m) => m.id)).toEqual([uuid(20)]);
      expect(list?.pages[0].items[0]).toMatchObject({
        unreadCount: 1,
        lastMessageAt: at(30),
      });
    });

    it('cùng một sự kiện tới hai lần ⇒ vẫn một tin', async () => {
      seedBuyer();
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      act(() => {
        h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent());
        h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent());
      });

      const thread = h.queryClient.getQueryData<MessagesData>(
        messagesQueryKey(BUYER, CONVERSATION_ID),
      );
      expect(thread?.pages[0].items).toHaveLength(1);
    });

    it('sự kiện của VAI KHÁC (viewerRole SHOP) bị bỏ qua khi đứng ở phạm vi người mua', async () => {
      seedBuyer();
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      act(() =>
        h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent({ viewerRole: 'SHOP' })),
      );

      const thread = h.queryClient.getQueryData<MessagesData>(
        messagesQueryKey(BUYER, CONVERSATION_ID),
      );
      expect(thread?.pages[0].items).toHaveLength(0);
    });

    it('phạm vi shop: bỏ qua sự kiện của shop KHÁC cùng chủ', async () => {
      h.queryClient.setQueryData(messagesQueryKey(SHOP, CONVERSATION_ID), messagesData([]));
      renderHook(() => useChatRealtimeSync(SHOP), { wrapper: h.wrapper });
      await h.connect();

      act(() =>
        h.socket.serverEmits(
          REALTIME_EVENTS.chatMessage,
          messageEvent({ viewerRole: 'SHOP', shopId: OTHER_SHOP_ID, senderRole: 'BUYER' }),
        ),
      );
      expect(
        h.queryClient.getQueryData<MessagesData>(messagesQueryKey(SHOP, CONVERSATION_ID))?.pages[0]
          .items,
      ).toHaveLength(0);

      act(() =>
        h.socket.serverEmits(
          REALTIME_EVENTS.chatMessage,
          messageEvent({ viewerRole: 'SHOP', shopId: SHOP_ID, senderRole: 'BUYER' }),
        ),
      );
      expect(
        h.queryClient.getQueryData<MessagesData>(messagesQueryKey(SHOP, CONVERSATION_ID))?.pages[0]
          .items,
      ).toHaveLength(1);
    });

    it('payload sai hình dạng (thiếu message) bị bỏ qua, không ném lỗi', async () => {
      seedBuyer();
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      expect(() =>
        act(() =>
          h.socket.serverEmits(REALTIME_EVENTS.chatMessage, {
            viewerRole: 'BUYER',
            shopId: SHOP_ID,
          }),
        ),
      ).not.toThrow();
    });

    it('enabled=false ⇒ bỏ qua mọi sự kiện', async () => {
      seedBuyer();
      renderHook(() => useChatRealtimeSync(BUYER, { enabled: false }), { wrapper: h.wrapper });
      await h.connect();

      act(() => h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent()));

      const thread = h.queryClient.getQueryData<MessagesData>(
        messagesQueryKey(BUYER, CONVERSATION_ID),
      );
      expect(thread?.pages[0].items).toHaveLength(0);
    });

    it('làm mới huy hiệu theo lô (không tự cộng +1) khi có tin của đối phương', async () => {
      seedBuyer();
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();
      invalidate.mockClear(); // bỏ lần làm mới do vừa nối
      vi.useFakeTimers();
      try {
        act(() => h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageEvent()));
        expect(h.queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 0 });
        act(() => {
          vi.advanceTimersByTime(300);
        });
      } finally {
        vi.useRealTimers();
      }

      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
      expect(keys).toContainEqual(unreadCountQueryKey(BUYER));
    });
  });

  describe('chat:read', () => {
    it('ghi mốc đối phương đã đọc tới (cache riêng, không theo phạm vi), chỉ tăng', async () => {
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      act(() =>
        h.socket.serverEmits(REALTIME_EVENTS.chatRead, {
          conversationId: CONVERSATION_ID,
          readAt: at(9),
        }),
      );
      act(() =>
        h.socket.serverEmits(REALTIME_EVENTS.chatRead, {
          conversationId: CONVERSATION_ID,
          readAt: at(3),
        }),
      );

      expect(h.queryClient.getQueryData(otherReadMarkQueryKey(CONVERSATION_ID))).toBe(at(9));
    });

    it('payload sai (conversationId không phải UUID) bị bỏ qua', async () => {
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();

      act(() =>
        h.socket.serverEmits(REALTIME_EVENTS.chatRead, { conversationId: 'abc', readAt: at(9) }),
      );

      expect(h.queryClient.getQueryData(otherReadMarkQueryKey('abc'))).toBeUndefined();
    });
  });

  describe('nối lại ⇒ làm mới để lấp khoảng trống', () => {
    const invalidatedKeys = (spy: MockInstance<QueryClient['invalidateQueries']>) =>
      spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);

    it('LẦN NỐI ĐẦU: làm mới mọi query của phạm vi (danh sách, huy hiệu, hội thoại đang mở) bằng tiền tố', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.settle();
      expect(invalidate).not.toHaveBeenCalled(); // chưa nối thì chưa làm mới

      act(() => h.socket.serverConnects());

      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      expect(invalidatedKeys(invalidate)).toEqual([['chat', 'buyer']]);
    });

    it('rớt rồi nối lại ⇒ làm mới thêm một lần nữa', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));

      vi.useFakeTimers();
      try {
        act(() => h.socket.serverDisconnects('transport close'));
        act(() => {
          vi.advanceTimersByTime(60_000); // hết backoff ⇒ client dựng socket mới (cùng FakeSocket)
        });
      } finally {
        vi.useRealTimers();
      }
      await h.settle();
      act(() => h.socket.serverConnects());

      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    });

    it('phạm vi shop làm mới đúng tiền tố của shop đó, không đụng phạm vi người mua', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(SHOP), { wrapper: h.wrapper });
      await h.connect();

      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      expect(invalidatedKeys(invalidate)).toEqual([['chat', 'shop', SHOP_ID]]);
    });

    it('enabled=false ⇒ không làm mới khi nối', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(BUYER, { enabled: false }), { wrapper: h.wrapper });
      await h.connect();
      await h.settle();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('gắn hook khi socket ĐÃ đang kết nối (vd Header đã giữ một bản) ⇒ không làm mới thêm', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useChatRealtimeSync(BUYER), { wrapper: h.wrapper });
      await h.connect();
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      invalidate.mockClear();

      renderHook(() => useChatRealtimeSync(SHOP), { wrapper: h.wrapper });
      await h.settle();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('đổi phạm vi hoặc bật enabled khi đang kết nối ⇒ không làm mới thêm (query mới tự nạp)', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      const { rerender } = renderHook(
        ({ scope, enabled }) => useChatRealtimeSync(scope, { enabled }),
        { wrapper: h.wrapper, initialProps: { scope: SHOP as ChatScope, enabled: false } },
      );
      await h.connect();
      await h.settle();
      invalidate.mockClear();

      rerender({ scope: SHOP, enabled: true });
      rerender({ scope: { role: 'SHOP', shopId: OTHER_SHOP_ID }, enabled: true });
      rerender({ scope: BUYER, enabled: true });
      await h.settle();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('render lại khi vẫn đang kết nối KHÔNG làm mới thêm', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      const { rerender } = renderHook(
        () => useChatRealtimeSync({ role: 'SHOP', shopId: SHOP_ID }),
        { wrapper: h.wrapper },
      );
      await h.connect();
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));

      rerender();
      rerender();
      await h.settle();

      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });
});
