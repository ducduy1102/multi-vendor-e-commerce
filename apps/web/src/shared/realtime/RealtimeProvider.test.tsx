import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { API_BASE_URL } from '@/shared/lib/api-client';
import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import type { SocketFactory } from './realtime-client';
import { RealtimeProvider } from './RealtimeProvider';
import { FakeSocket } from './test-socket';
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

function StatusProbe() {
  return <p data-testid="status">{useRealtimeStatus()}</p>;
}

// Sống với đồng hồ thật: luồng provider chỉ dùng microtask (không hẹn giờ) nên chỉ cần chờ promise xong.
const settle = () => act(async () => {});

function harness() {
  const sockets: FakeSocket[] = [];
  const createSocket = vi.fn<SocketFactory>(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return Promise.resolve(socket);
  });
  const refreshSession = vi.fn<() => Promise<RefreshOutcome>>().mockResolvedValue('refreshed');
  const ui = (
    <RealtimeProvider createSocket={createSocket} refreshSession={refreshSession}>
      <StatusProbe />
    </RealtimeProvider>
  );
  return { sockets, createSocket, refreshSession, ui };
}

function signIn(user = USER) {
  act(() => {
    useAuthStore.setState({ user, isHydrating: false });
  });
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isHydrating: true });
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset store: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    useAuthStore.setState({ user: null, isHydrating: true });
    vi.restoreAllMocks();
  });

  it('khách vãng lai (đã hydrate xong, không có user) ⇒ KHÔNG tạo socket, không nạp thư viện', async () => {
    const { ui, createSocket } = harness();
    useAuthStore.setState({ user: null, isHydrating: false });

    render(ui);
    await settle();

    expect(createSocket).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });

  it('còn đang hydrate (chưa biết ai đăng nhập) ⇒ chưa tạo socket, kể cả khi store đã có user', async () => {
    const { ui, createSocket } = harness();
    useAuthStore.setState({ user: USER, isHydrating: true });

    render(ui);
    await settle();

    expect(createSocket).not.toHaveBeenCalled();
  });

  it('đăng nhập (hydrate xong + có user) ⇒ tạo đúng MỘT socket tới API và kết nối', async () => {
    const { ui, createSocket, sockets } = harness();
    render(ui);
    await settle();
    expect(createSocket).not.toHaveBeenCalled();

    signIn();
    await settle();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(createSocket.mock.calls[0][0]).toBe(API_BASE_URL);
    expect(sockets[0].connect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    act(() => sockets[0].serverConnects());
    expect(screen.getByTestId('status')).toHaveTextContent('connected');
  });

  it('React StrictMode (mount → cleanup → mount) vẫn chỉ MỘT socket', async () => {
    const { ui, createSocket, sockets } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });

    render(<StrictMode>{ui}</StrictMode>);
    await settle();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].connect).toHaveBeenCalledTimes(1);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
  });

  it('đăng xuất (user về null) ⇒ ngắt socket và về offline', async () => {
    const { ui, sockets } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });
    render(ui);
    await settle();
    act(() => sockets[0].serverConnects());

    act(() => useAuthStore.getState().clearUser());
    await settle();

    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });

  it('đổi sang người dùng khác ⇒ ngắt kết nối của người cũ và nối socket mới', async () => {
    const { ui, createSocket, sockets } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });
    render(ui);
    await settle();

    signIn({ ...USER, id: 'user-2', email: 'two@example.com' });
    await settle();

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(sockets[1].connect).toHaveBeenCalledTimes(1);
  });

  it('cập nhật hồ sơ (cùng id, đổi tên) KHÔNG làm kết nối lại', async () => {
    const { ui, createSocket } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });
    render(ui);
    await settle();

    signIn({ ...USER, name: 'Tên mới' });
    await settle();

    expect(createSocket).toHaveBeenCalledTimes(1);
  });

  it('gỡ provider (unmount) ⇒ ngắt socket', async () => {
    const { ui, sockets } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });
    const { unmount } = render(ui);
    await settle();

    unmount();

    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('server báo auth:expired rồi đóng ⇒ gia hạn phiên đúng 1 lần rồi nối lại cùng socket', async () => {
    const { ui, sockets, refreshSession } = harness();
    useAuthStore.setState({ user: USER, isHydrating: false });
    render(ui);
    await settle();
    act(() => sockets[0].serverConnects());

    act(() => {
      sockets[0].serverEmits('auth:expired');
      sockets[0].serverDisconnects('io server disconnect');
    });
    await settle();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(sockets[0].connect).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
  });

  it('token bị từ chối lúc nối ⇒ gia hạn 1 lần; BE từ chối gia hạn (phiên mất) ⇒ dừng, hiện offline', async () => {
    const { ui, sockets, refreshSession } = harness();
    refreshSession.mockResolvedValue('rejected');
    useAuthStore.setState({ user: USER, isHydrating: false });
    render(ui);
    await settle();

    act(() => sockets[0].serverRejects('INVALID_TOKEN'));
    await settle();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(sockets[0].connect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });
});
