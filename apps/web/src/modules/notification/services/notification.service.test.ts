import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL, API_PREFIX, ApiError } from '@/shared/lib/api-client';

import { at, makeNotification, uuid } from '../notification-test-data';
import { getUnreadCount, listNotifications, markAllRead, markRead } from './notification.service';

const BASE = `${API_BASE_URL}${API_PREFIX}`;

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

describe('notification.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('listNotifications', () => {
    it('GET /notifications, gửi cookie phiên, không mang tham số thừa', async () => {
      ok({ items: [], nextCursor: null });

      await listNotifications();

      expect(lastCall()[0]).toBe(`${BASE}/notifications`);
      expect(lastCall()[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    });

    it('unreadOnly=true ⇒ ?unreadOnly=true; unreadOnly=false ⇒ KHÔNG gửi (mặc định của BE là false)', async () => {
      ok({ items: [], nextCursor: null });
      await listNotifications({ unreadOnly: true });
      expect(lastCall()[0]).toBe(`${BASE}/notifications?unreadOnly=true`);

      vi.unstubAllGlobals();
      ok({ items: [], nextCursor: null });
      await listNotifications({ unreadOnly: false });
      expect(lastCall()[0]).toBe(`${BASE}/notifications`);
    });

    it('con trỏ và limit đi qua query, con trỏ được mã hoá', async () => {
      ok({ items: [], nextCursor: null });

      await listNotifications({ cursor: 'a b/c', limit: 20, unreadOnly: true });

      const query = new URL(lastCall()[0]).searchParams;
      expect(query.get('cursor')).toBe('a b/c');
      expect(query.get('limit')).toBe('20');
      expect(query.get('unreadOnly')).toBe('true');
    });

    it('parse response: thông báo đã biết giữ nguyên, nextCursor được chuyển lại', async () => {
      ok({
        items: [{ ...makeNotification({ id: uuid(5), createdAt: at(1) }) }],
        nextCursor: 'abc_-9',
      });

      const result = await listNotifications();

      expect(result.nextCursor).toBe('abc_-9');
      expect(result.items[0]).toMatchObject({
        id: uuid(5),
        type: 'ORDER_NEW',
        readAt: null,
        data: { orderId: expect.any(String) },
      });
    });

    it('loại lạ ⇒ rơi về UNKNOWN với data rỗng, KHÔNG làm hỏng cả danh sách, dữ liệu lạ không đi tiếp', async () => {
      ok({
        items: [
          {
            id: uuid(6),
            type: 'BRAND_NEW_TYPE',
            data: { url: 'https://evil.example' },
            readAt: null,
            createdAt: at(2),
          },
          makeNotification({ id: uuid(7), createdAt: at(1) }),
        ],
        nextCursor: null,
      });

      const result = await listNotifications();

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: uuid(6),
        type: 'UNKNOWN',
        data: {},
        readAt: null,
        createdAt: at(2),
      });
      expect(result.items[1].type).toBe('ORDER_NEW');
    });

    it('response sai khung (id không phải UUID) ⇒ ném ZodError, không trả dữ liệu hỏng', async () => {
      ok({
        items: [{ id: 'not-a-uuid', type: 'ORDER_NEW', data: {}, readAt: null, createdAt: at(0) }],
        nextCursor: null,
      });

      await expect(listNotifications()).rejects.toMatchObject({ name: 'ZodError' });
    });

    it('401 ⇒ ApiError giữ nguyên status', async () => {
      mockFetch({ success: false, message: 'Chưa đăng nhập' }, 401);
      // 401 thử gia hạn phiên một lần rồi trả lại lỗi gốc; fetch mock luôn trả 401.

      await expect(listNotifications()).rejects.toMatchObject({ status: 401 });
      await expect(listNotifications()).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('getUnreadCount', () => {
    it('GET /notifications/unread-count và parse { unreadCount }', async () => {
      ok({ unreadCount: 7 });

      const result = await getUnreadCount();

      expect(lastCall()[0]).toBe(`${BASE}/notifications/unread-count`);
      expect(lastCall()[1]).toMatchObject({ method: 'GET' });
      expect(result).toEqual({ unreadCount: 7 });
    });

    it('số âm hoặc không nguyên ⇒ ném ZodError', async () => {
      ok({ unreadCount: -1 });
      await expect(getUnreadCount()).rejects.toMatchObject({ name: 'ZodError' });

      vi.unstubAllGlobals();
      ok({ unreadCount: 1.5 });
      await expect(getUnreadCount()).rejects.toMatchObject({ name: 'ZodError' });
    });
  });

  describe('markRead', () => {
    it('POST /notifications/:id/read và parse { readAt }', async () => {
      ok({ readAt: at(5) });

      const result = await markRead(uuid(1));

      expect(lastCall()[0]).toBe(`${BASE}/notifications/${uuid(1)}/read`);
      expect(lastCall()[1]).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(result).toEqual({ readAt: at(5) });
    });

    it('id được mã hoá: không tin nó không chứa ký tự đặc biệt', async () => {
      ok({ readAt: at(5) });

      await markRead('a/b?c');

      expect(lastCall()[0]).toBe(`${BASE}/notifications/a%2Fb%3Fc/read`);
    });

    it('404 (của người khác / không tồn tại) ⇒ ApiError 404', async () => {
      mockFetch({ success: false, message: 'Notification not found' }, 404);

      await expect(markRead(uuid(1))).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('markAllRead', () => {
    it('POST /notifications/read-all và parse { updatedCount }', async () => {
      ok({ updatedCount: 3 });

      const result = await markAllRead();

      expect(lastCall()[0]).toBe(`${BASE}/notifications/read-all`);
      expect(lastCall()[1]).toMatchObject({ method: 'POST' });
      expect(result).toEqual({ updatedCount: 3 });
    });
  });
});
