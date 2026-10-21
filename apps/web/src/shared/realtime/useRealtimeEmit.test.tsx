import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import type { SocketFactory } from './realtime-client';
import { RealtimeProvider } from './RealtimeProvider';
import { FakeSocket } from './test-socket';
import { useRealtimeEmit } from './useRealtimeEmit';

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

const settle = () => act(async () => {});

describe('useRealtimeEmit', () => {
  let socket: FakeSocket;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
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

  it('đang kết nối ⇒ giao sự kiện cho socket và trả true', async () => {
    const { result } = renderHook(() => useRealtimeEmit(), { wrapper });
    await settle();
    act(() => socket.serverConnects());

    const sent = result.current('chat:typing', { conversationId: 'abc' });

    expect(sent).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('chat:typing', { conversationId: 'abc' });
  });

  it('chưa nối ⇒ trả false và KHÔNG xếp hàng: nối xong cũng không có gì được gửi muộn', async () => {
    const { result } = renderHook(() => useRealtimeEmit(), { wrapper });
    await settle();

    expect(result.current('chat:typing', { conversationId: 'abc' })).toBe(false);
    act(() => socket.serverConnects());

    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('mất kết nối ⇒ trả false', async () => {
    const { result } = renderHook(() => useRealtimeEmit(), { wrapper });
    await settle();
    act(() => socket.serverConnects());
    act(() => socket.serverDisconnects('transport close'));

    expect(result.current('chat:typing')).toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('khách vãng lai (không có user) ⇒ không có kết nối, trả false', async () => {
    useAuthStore.setState({ user: null, isHydrating: false });
    const { result } = renderHook(() => useRealtimeEmit(), { wrapper });
    await settle();

    expect(result.current('chat:typing')).toBe(false);
  });

  it('không có RealtimeProvider ⇒ an toàn: trả false, không ném lỗi', () => {
    const { result } = renderHook(() => useRealtimeEmit());

    expect(() => result.current('chat:typing')).not.toThrow();
    expect(result.current('chat:typing')).toBe(false);
  });

  it('hàm trả về ổn định giữa các lần render (dùng được trong deps)', async () => {
    const { result, rerender } = renderHook(() => useRealtimeEmit(), { wrapper });
    const first = result.current;

    rerender();
    await settle();

    expect(result.current).toBe(first);
  });
});
