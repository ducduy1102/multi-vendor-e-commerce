import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL, API_PREFIX, ApiError } from '@/shared/lib/api-client';

import { CONVERSATION_ID, SHOP_ID, at, makeMessage, makeSummary, uuid } from '../chat-test-data';
import type { ChatScope } from '../types';
import {
  getUnreadCount,
  listConversations,
  listMessages,
  markRead,
  openConversation,
  sendMessage,
} from './chat.service';

const BASE = `${API_BASE_URL}${API_PREFIX}`;
const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}
const ok = (data: unknown, status = 200) => mockFetch({ success: true, data }, status);
const lastCall = () => vi.mocked(fetch).mock.calls[0] as [string, RequestInit];

describe('chat.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('đường dẫn theo phạm vi', () => {
    it('chủ shop: GET /shops/:shopId/conversations', async () => {
      ok({ items: [], nextCursor: null });

      await listConversations(SHOP);

      expect(lastCall()[0]).toBe(`${BASE}/shops/${SHOP_ID}/conversations`);
    });

    it('người mua: GET /conversations', async () => {
      ok({ items: [], nextCursor: null });

      await listConversations(BUYER);

      expect(lastCall()[0]).toBe(`${BASE}/conversations`);
      expect(lastCall()[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    });

    it('shopId và id hội thoại được mã hoá: không tin chúng không chứa ký tự đặc biệt', async () => {
      ok({ items: [], nextCursor: null });

      await listMessages({ role: 'SHOP', shopId: 'a/b?c' }, 'x y/z');

      expect(lastCall()[0]).toBe(`${BASE}/shops/a%2Fb%3Fc/conversations/x%20y%2Fz/messages`);
    });
  });

  describe('listConversations / listMessages', () => {
    it('truyền con trỏ `before` và `limit` qua query string; không truyền thì không có dấu ?', async () => {
      ok({ items: [], nextCursor: null });
      await listConversations(BUYER, { before: 'cursor-1', limit: 20 });
      expect(lastCall()[0]).toBe(`${BASE}/conversations?before=cursor-1&limit=20`);

      vi.unstubAllGlobals();
      ok({ items: [], nextCursor: null });
      await listConversations(BUYER, {});
      expect(lastCall()[0]).toBe(`${BASE}/conversations`);
    });

    it('con trỏ có ký tự đặc biệt được mã hoá trong query', async () => {
      ok({ items: [], nextCursor: null });

      await listMessages(BUYER, CONVERSATION_ID, { before: 'a b&c=d' });

      expect(lastCall()[0]).toBe(
        `${BASE}/conversations/${CONVERSATION_ID}/messages?before=a+b%26c%3Dd`,
      );
    });

    it('trả về dữ liệu ĐÃ qua Zod (trường lạ như email bị loại)', async () => {
      ok({
        items: [{ ...makeSummary(), email: 'leak@test.local' }],
        nextCursor: 'next',
        extra: 1,
      });

      const result = await listConversations(BUYER);

      expect(result.nextCursor).toBe('next');
      expect(result.items[0]).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('extra');
    });

    it('otherLastReadAt (dấu "Đã xem") được giữ nguyên qua Zod; thiếu hoặc sai định dạng ⇒ từ chối', async () => {
      ok({
        items: [makeSummary({ otherLastReadAt: at(4) }), makeSummary({ otherLastReadAt: null })],
        nextCursor: null,
      });
      const result = await listConversations(BUYER);
      expect(result.items.map((i) => i.otherLastReadAt)).toEqual([at(4), null]);

      vi.unstubAllGlobals();
      const { otherLastReadAt: _omitted, ...withoutMark } = makeSummary();
      void _omitted;
      ok({ items: [withoutMark], nextCursor: null });
      await expect(listConversations(BUYER)).rejects.toThrow();

      vi.unstubAllGlobals();
      ok({ items: [{ ...makeSummary(), otherLastReadAt: 'hôm qua' }], nextCursor: null });
      await expect(listConversations(BUYER)).rejects.toThrow();
    });

    it('response sai hình dạng ⇒ ném lỗi Zod (không đưa dữ liệu lạ vào giao diện)', async () => {
      ok({ items: [{ id: 'không-phải-uuid' }], nextCursor: null });

      await expect(listConversations(BUYER)).rejects.toThrow();
    });

    it('listMessages: tin nhắn parse đúng, kể cả clientMessageId của tin mình gửi', async () => {
      const message = makeMessage({ clientMessageId: uuid(77), createdAt: at(5) });
      ok({ items: [message], nextCursor: null });

      const result = await listMessages(BUYER, CONVERSATION_ID);

      expect(result.items).toEqual([message]);
    });
  });

  describe('sendMessage', () => {
    it('POST JSON { content, clientMessageId } tới đúng hội thoại và trả về tin đã parse', async () => {
      const message = makeMessage({ clientMessageId: uuid(5) });
      ok(message, 201);

      const result = await sendMessage(BUYER, CONVERSATION_ID, {
        content: 'xin chào',
        clientMessageId: uuid(5),
      });

      expect(result).toEqual(message);
      expect(lastCall()[0]).toBe(`${BASE}/conversations/${CONVERSATION_ID}/messages`);
      expect(lastCall()[1]).toMatchObject({ method: 'POST' });
      expect(JSON.parse(String(lastCall()[1].body))).toEqual({
        content: 'xin chào',
        clientMessageId: uuid(5),
      });
    });

    it('gửi lại tin đã nhận (BE trả 200 thay vì 201) vẫn là thành công', async () => {
      ok(makeMessage({ clientMessageId: uuid(5) }), 200);

      await expect(
        sendMessage(BUYER, CONVERSATION_ID, { content: 'x', clientMessageId: uuid(5) }),
      ).resolves.toMatchObject({ clientMessageId: uuid(5) });
    });

    it('chủ shop gửi qua đường dẫn của shop', async () => {
      ok(makeMessage({ senderRole: 'SHOP' }), 201);

      await sendMessage(SHOP, CONVERSATION_ID, { content: 'x', clientMessageId: uuid(5) });

      expect(lastCall()[0]).toBe(
        `${BASE}/shops/${SHOP_ID}/conversations/${CONVERSATION_ID}/messages`,
      );
    });

    it.each([
      [409, 'CHAT_SHOP_UNAVAILABLE'],
      [429, 'CHAT_RATE_LIMITED'],
      [429, 'CHAT_AWAITING_REPLY'],
    ])(
      'lỗi %i %s ⇒ ApiError mang đúng status và code (để dịch và quyết định thử lại)',
      async (status, code) => {
        mockFetch({ success: false, data: null, message: 'x', code }, status);

        const error = await sendMessage(BUYER, CONVERSATION_ID, {
          content: 'x',
          clientMessageId: uuid(5),
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status, code });
      },
    );

    it('mất mạng ⇒ ApiError status 0 (kết quả CHƯA RÕ — thử lại an toàn nhờ idempotency)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      await expect(
        sendMessage(BUYER, CONVERSATION_ID, { content: 'x', clientMessageId: uuid(5) }),
      ).rejects.toMatchObject({ status: 0 });
    });
  });

  describe('markRead / getUnreadCount / openConversation', () => {
    it('markRead: POST .../read không có body, trả { readAt }', async () => {
      ok({ readAt: at(3) });

      const result = await markRead(SHOP, CONVERSATION_ID);

      expect(result).toEqual({ readAt: at(3) });
      expect(lastCall()[0]).toBe(`${BASE}/shops/${SHOP_ID}/conversations/${CONVERSATION_ID}/read`);
      expect(lastCall()[1]).toMatchObject({ method: 'POST' });
      expect(lastCall()[1].body).toBeUndefined();
    });

    it('getUnreadCount: GET .../unread-count của đúng phạm vi', async () => {
      ok({ unreadCount: 4 });
      expect(await getUnreadCount(BUYER)).toEqual({ unreadCount: 4 });
      expect(lastCall()[0]).toBe(`${BASE}/conversations/unread-count`);

      vi.unstubAllGlobals();
      ok({ unreadCount: 2 });
      await getUnreadCount(SHOP);
      expect(lastCall()[0]).toBe(`${BASE}/shops/${SHOP_ID}/conversations/unread-count`);
    });

    it('getUnreadCount: số âm hoặc không nguyên bị từ chối', async () => {
      ok({ unreadCount: -1 });

      await expect(getUnreadCount(BUYER)).rejects.toThrow();
    });

    it('openConversation: POST /conversations với { shopId }, trả bản tóm tắt đã parse', async () => {
      const summary = makeSummary({ lastMessage: null, lastMessageAt: null });
      ok(summary, 200);

      const result = await openConversation(SHOP_ID);

      expect(result).toEqual(summary);
      expect(lastCall()[0]).toBe(`${BASE}/conversations`);
      expect(lastCall()[1]).toMatchObject({ method: 'POST' });
      expect(JSON.parse(String(lastCall()[1].body))).toEqual({ shopId: SHOP_ID });
    });

    it.each([
      [409, 'CHAT_OWN_SHOP'],
      [429, 'CHAT_CONVERSATION_LIMIT'],
      [404, undefined],
    ])('openConversation lỗi %i ⇒ ApiError %s', async (status, code) => {
      mockFetch({ success: false, data: null, message: 'x', ...(code ? { code } : {}) }, status);

      await expect(openConversation(SHOP_ID)).rejects.toMatchObject({ status, code });
    });
  });
});
