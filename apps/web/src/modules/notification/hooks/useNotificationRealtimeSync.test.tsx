import { REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  createRealtimeHarness,
  resetRealtimeHarnessAuth,
  type RealtimeTestHarness,
} from '@/shared/realtime/test-harness';

import {
  at,
  makeNotification,
  makeUnknownNotification,
  notificationsData,
  uuid,
} from '../notification-test-data';
import type { NotificationUnreadCount } from '../types';
import type { NotificationsData } from './notification-cache';
import {
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';
import { useNotificationRealtimeSync } from './useNotificationRealtimeSync';

const ALL = notificationListQueryKey('all');
const NEW = REALTIME_EVENTS.notificationNew;

describe('useNotificationRealtimeSync', () => {
  let h: RealtimeTestHarness;

  beforeEach(() => {
    h = createRealtimeHarness();
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset auth: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    resetRealtimeHarnessAuth();
    vi.restoreAllMocks();
  });

  const seed = () => {
    h.queryClient.setQueryData(ALL, notificationsData([makeNotification({ id: uuid(1) })]));
    h.queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 1,
    });
  };
  const idsOf = () =>
    h.queryClient.getQueryData<NotificationsData>(ALL)?.pages[0].items.map((n) => n.id);

  describe('notification:new', () => {
    it('thông báo mới vào ĐẦU danh sách đã nạp', async () => {
      seed();
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.connect();

      act(() => h.socket.serverEmits(NEW, makeNotification({ id: uuid(9), createdAt: at(30) })));

      expect(idsOf()).toEqual([uuid(9), uuid(1)]);
    });

    it('cùng một sự kiện tới hai lần ⇒ vẫn một dòng', async () => {
      seed();
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.connect();

      act(() => {
        h.socket.serverEmits(NEW, makeNotification({ id: uuid(9) }));
        h.socket.serverEmits(NEW, makeNotification({ id: uuid(9) }));
      });

      expect(idsOf()).toEqual([uuid(9), uuid(1)]);
    });

    it('loại lạ từ server ⇒ rơi về UNKNOWN nhưng vẫn vào danh sách, không ném lỗi', async () => {
      seed();
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.connect();

      act(() =>
        h.socket.serverEmits(NEW, {
          id: uuid(8),
          type: 'BRAND_NEW_TYPE',
          data: { url: 'https://evil.example' },
          readAt: null,
          createdAt: at(1),
        }),
      );

      const first = h.queryClient.getQueryData<NotificationsData>(ALL)?.pages[0].items[0];
      expect(first).toEqual(makeUnknownNotification({ id: uuid(8), createdAt: at(1) }));
    });

    it('payload sai khung (id không phải UUID) bị bỏ qua, không ném lỗi', async () => {
      seed();
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.connect();

      expect(() =>
        act(() =>
          h.socket.serverEmits(NEW, { id: 'abc', type: 'ORDER_NEW', data: {}, readAt: null }),
        ),
      ).not.toThrow();
      expect(idsOf()).toEqual([uuid(1)]);
    });

    it('enabled=false ⇒ bỏ qua mọi sự kiện và KHÔNG gọi onNew', async () => {
      seed();
      const onNew = vi.fn();
      renderHook(() => useNotificationRealtimeSync({ enabled: false, onNew }), {
        wrapper: h.wrapper,
      });
      await h.connect();

      act(() => h.socket.serverEmits(NEW, makeNotification({ id: uuid(9) })));

      expect(idsOf()).toEqual([uuid(1)]);
      expect(onNew).not.toHaveBeenCalled();
    });

    it('onNew nhận thông báo ĐÃ nằm trong cache, mỗi thông báo một lần, luôn là bản mới nhất của callback', async () => {
      seed();
      const seen: (string[] | undefined)[] = [];
      const first = vi.fn(() => seen.push(idsOf()));
      const second = vi.fn(() => seen.push(idsOf()));
      const { rerender } = renderHook(({ onNew }) => useNotificationRealtimeSync({ onNew }), {
        wrapper: h.wrapper,
        initialProps: { onNew: first },
      });
      await h.connect();

      act(() => h.socket.serverEmits(NEW, makeNotification({ id: uuid(9) })));
      rerender({ onNew: second });
      act(() => h.socket.serverEmits(NEW, makeNotification({ id: uuid(10) })));

      expect(first).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledWith(expect.objectContaining({ id: uuid(9) }));
      expect(second).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: uuid(10) }));
      expect(seen[0]).toEqual([uuid(9), uuid(1)]); // đã vào cache trước khi gọi onNew
    });

    it('làm mới huy hiệu theo lô (không tự cộng +1)', async () => {
      seed();
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.connect();
      invalidate.mockClear(); // bỏ lần làm mới do vừa nối
      vi.useFakeTimers();
      try {
        act(() => h.socket.serverEmits(NEW, makeNotification({ id: uuid(9) })));
        expect(h.queryClient.getQueryData(NOTIFICATION_UNREAD_COUNT_QUERY_KEY)).toEqual({
          unreadCount: 1,
        });
        act(() => {
          vi.advanceTimersByTime(300);
        });
      } finally {
        vi.useRealTimers();
      }

      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
      expect(keys).toContainEqual(NOTIFICATION_UNREAD_COUNT_QUERY_KEY);
    });
  });

  describe('nối lại ⇒ làm mới để lấp khoảng trống', () => {
    const invalidatedKeys = (spy: MockInstance<QueryClient['invalidateQueries']>) =>
      spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);

    it('LẦN NỐI ĐẦU: làm mới mọi query thông báo bằng tiền tố', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
      await h.settle();
      expect(invalidate).not.toHaveBeenCalled(); // chưa nối thì chưa làm mới

      act(() => h.socket.serverConnects());

      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      expect(invalidatedKeys(invalidate)).toEqual([['notification']]);
    });

    it('rớt rồi nối lại ⇒ làm mới thêm một lần nữa', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useNotificationRealtimeSync(), { wrapper: h.wrapper });
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

    it('enabled=false ⇒ không làm mới khi nối', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      renderHook(() => useNotificationRealtimeSync({ enabled: false }), { wrapper: h.wrapper });
      await h.connect();
      await h.settle();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('gắn hook khi socket ĐÃ đang kết nối (mount trễ do nạp động) ⇒ làm mới đúng MỘT lần, KHÔNG huỷ truy vấn đang bay', async () => {
      // MỘT Provider duy nhất (mỗi `renderHook` tạo Provider riêng và chưa nối): hook "trễ" chỉ được dựng sau khi socket
      // đã nối, đúng như `React.lazy` ở lazy-chat.
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      function Late() {
        useNotificationRealtimeSync();
        return null;
      }
      function Page({ showLate }: { showLate: boolean }) {
        useNotificationRealtimeSync();
        return showLate ? <Late /> : null;
      }
      const view = render(<Page showLate={false} />, { wrapper: h.wrapper });
      await h.connect();
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      // Lần nối thật: dùng mặc định (huỷ rồi nạp lại truy vấn đang bay, vì kết nối cũ có thể đã treo).
      expect(invalidate.mock.calls[0][1]).toEqual({ cancelRefetch: true });
      invalidate.mockClear();

      view.rerender(<Page showLate />);
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: ['notification'] },
        { cancelRefetch: false },
      );

      view.rerender(<Page showLate />);
      await h.settle();
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('bật enabled khi đang kết nối ⇒ không làm mới thêm (query mới tự nạp)', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      const { rerender } = renderHook(({ enabled }) => useNotificationRealtimeSync({ enabled }), {
        wrapper: h.wrapper,
        initialProps: { enabled: false },
      });
      await h.connect();
      await h.settle();
      invalidate.mockClear();

      rerender({ enabled: true });
      await h.settle();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('render lại khi vẫn đang kết nối KHÔNG làm mới thêm', async () => {
      const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
      const { rerender } = renderHook(() => useNotificationRealtimeSync(), {
        wrapper: h.wrapper,
      });
      await h.connect();
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));

      rerender();
      rerender();
      await h.settle();

      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });
});
