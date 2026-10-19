import { chatReadPayloadSchema, chatTypingPayloadSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import type { SocketFactory } from './realtime-client';
import { RealtimeProvider } from './RealtimeProvider';
import { FakeSocket } from './test-socket';
import { useRealtimeEvent } from './useRealtimeEvent';
import { useRealtimeStatus } from './useRealtimeStatus';

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};
const CONVERSATION_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const VALID = { conversationId: CONVERSATION_ID, readAt: '2030-01-01T00:00:00.000Z' };

const settle = () => act(async () => {});

describe('useRealtimeEvent / useRealtimeStatus', () => {
  let socket: FakeSocket;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(async () => {
    socket = new FakeSocket();
    const createSocket = vi.fn<SocketFactory>(() => Promise.resolve(socket));
    const refreshSession = vi.fn<() => Promise<RefreshOutcome>>().mockResolvedValue('refreshed');
    wrapper = ({ children }) => (
      <RealtimeProvider createSocket={createSocket} refreshSession={refreshSession}>
        {children}
      </RealtimeProvider>
    );
    useAuthStore.setState({ user: USER, isHydrating: false });
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset store: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    useAuthStore.setState({ user: null, isHydrating: true });
    vi.restoreAllMocks();
  });

  describe('useRealtimeEvent', () => {
    it('payload hợp lệ ⇒ handler nhận dữ liệu ĐÃ parse (trường lạ bị loại)', async () => {
      const handler = vi.fn();
      renderHook(() => useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, handler), {
        wrapper,
      });
      await settle();
      act(() => socket.serverConnects());

      act(() => socket.serverEmits(REALTIME_EVENTS.chatRead, { ...VALID, injected: 'x' }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(VALID);
    });

    it.each([
      ['thiếu trường', { conversationId: CONVERSATION_ID }],
      ['conversationId không phải UUID', { ...VALID, conversationId: 'abc' }],
      ['readAt không phải ISO', { ...VALID, readAt: 'hôm qua' }],
      ['không phải object', 'x'],
      ['null', null],
      ['không có payload', undefined],
    ])(
      'payload sai schema (%s) ⇒ handler KHÔNG được gọi và không ném lỗi',
      async (_name, payload) => {
        const handler = vi.fn();
        renderHook(
          () => useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, handler),
          {
            wrapper,
          },
        );
        await settle();
        act(() => socket.serverConnects());

        expect(() =>
          act(() => socket.serverEmits(REALTIME_EVENTS.chatRead, payload)),
        ).not.toThrow();

        expect(handler).not.toHaveBeenCalled();
      },
    );

    it('chỉ nhận đúng sự kiện đã đăng ký', async () => {
      const handler = vi.fn();
      renderHook(
        () => useRealtimeEvent(REALTIME_EVENTS.chatTyping, chatTypingPayloadSchema, handler),
        { wrapper },
      );
      await settle();

      act(() => socket.serverEmits(REALTIME_EVENTS.chatRead, VALID));
      act(() =>
        socket.serverEmits(REALTIME_EVENTS.chatTyping, { conversationId: CONVERSATION_ID }),
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID });
    });

    it('luôn gọi handler MỚI NHẤT (không cần useCallback) mà không đăng ký lại', async () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHook(
        ({ handler }) => useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, handler),
        { wrapper, initialProps: { handler: first } },
      );
      await settle();

      rerender({ handler: second });
      act(() => socket.serverEmits(REALTIME_EVENTS.chatRead, VALID));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('unmount ⇒ ngừng nhận', async () => {
      const handler = vi.fn();
      const { unmount } = renderHook(
        () => useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, handler),
        { wrapper },
      );
      await settle();

      unmount();
      act(() => socket.serverEmits(REALTIME_EVENTS.chatRead, VALID));

      expect(handler).not.toHaveBeenCalled();
    });

    it('không có RealtimeProvider phía trên ⇒ không làm gì, không ném lỗi', () => {
      const handler = vi.fn();

      expect(() => render(<Probe handler={handler} />)).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('useRealtimeStatus', () => {
    it('đi theo vòng đời kết nối: connecting → connected → connecting (mất mạng) → offline (đăng xuất)', async () => {
      const { result } = renderHook(() => useRealtimeStatus(), { wrapper });
      await settle();
      expect(result.current).toBe('connecting');

      act(() => socket.serverConnects());
      expect(result.current).toBe('connected');

      act(() => socket.serverDisconnects('transport close'));
      expect(result.current).toBe('connecting');

      act(() => useAuthStore.getState().clearUser());
      await settle();
      expect(result.current).toBe('offline');
    });

    it('không có RealtimeProvider ⇒ luôn offline', () => {
      const { result } = renderHook(() => useRealtimeStatus());

      expect(result.current).toBe('offline');
    });
  });
});

function Probe({ handler }: { handler: (payload: unknown) => void }) {
  useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, handler);
  return null;
}
