import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { registerSessionReset } from '@/shared/lib/session-reset';

import { SessionCacheReset } from './SessionCacheReset';

const USER_A = {
  id: 'user-a',
  email: 'a@example.com',
  name: 'An',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};
const USER_B = { ...USER_A, id: 'user-b', email: 'b@example.com', name: 'Bình' };

describe('SessionCacheReset', () => {
  let queryClient: QueryClient;

  const mount = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <SessionCacheReset />
      </QueryClientProvider>,
    );
  // Dữ liệu của nhiều module khác nhau: đơn hàng, wishlist, địa chỉ, tin nhắn.
  const seedCaches = () => {
    queryClient.setQueryData(['orders', 'list'], { items: [1] });
    queryClient.setQueryData(['wishlist'], { items: [2] });
    queryClient.setQueryData(['addresses'], { items: [3] });
    queryClient.setQueryData(['chat', 'buyer', 'conversations'], { pages: [] });
  };
  const cachedCount = () => queryClient.getQueryCache().getAll().length;
  // Bộ dọn của một store Zustand riêng tư (như hộp chờ chat) tự đăng ký vào sổ `session-reset`.
  const storeResetter = vi.fn();
  let unregister: () => void;

  beforeEach(() => {
    queryClient = new QueryClient();
    storeResetter.mockClear();
    unregister = registerSessionReset(storeResetter);
    useAuthStore.setState({ user: USER_A, isHydrating: false });
  });

  afterEach(() => {
    // Gỡ component TRƯỚC khi reset store: reset khi còn mount làm React cập nhật ngoài act().
    cleanup();
    unregister();
    useAuthStore.setState({ user: null, isHydrating: true });
  });

  it('đổi sang TÀI KHOẢN KHÁC ⇒ xoá cache của MỌI module (đơn hàng, wishlist, địa chỉ, chat) và chạy các bộ dọn đã đăng ký', () => {
    mount();
    seedCaches();
    expect(cachedCount()).toBe(4);

    act(() => useAuthStore.setState({ user: USER_B }));

    expect(cachedCount()).toBe(0);
    expect(storeResetter).toHaveBeenCalledTimes(1);
  });

  it('ĐĂNG XUẤT (user → null) ⇒ xoá', () => {
    mount();
    seedCaches();

    act(() => useAuthStore.setState({ user: null }));

    expect(cachedCount()).toBe(0);
    expect(storeResetter).toHaveBeenCalledTimes(1);
  });

  it('khôi phục phiên lúc mở trang (null → id) ⇒ KHÔNG xoá: các truy vấn chạy song song với /auth/me không bị loại oan', () => {
    useAuthStore.setState({ user: null, isHydrating: true });
    mount();
    seedCaches();

    act(() => useAuthStore.setState({ user: USER_A, isHydrating: false }));

    expect(cachedCount()).toBe(4);
    expect(storeResetter).not.toHaveBeenCalled();
  });

  it('đăng xuất rồi đăng nhập lại: chỉ xoá lúc đăng xuất, lúc đăng nhập lại không xoá dữ liệu vừa tải', () => {
    mount();
    seedCaches();
    act(() => useAuthStore.setState({ user: null }));
    expect(cachedCount()).toBe(0);

    queryClient.setQueryData(['public', 'categories'], { items: [1] });
    act(() => useAuthStore.setState({ user: USER_B }));

    expect(queryClient.getQueryData(['public', 'categories'])).toEqual({ items: [1] });
    expect(storeResetter).toHaveBeenCalledTimes(1);
  });

  it('làm mới phiên (cùng id, object user mới) ⇒ KHÔNG xoá: dữ liệu đang xem không được mất', () => {
    mount();
    seedCaches();

    act(() => useAuthStore.setState({ user: { ...USER_A, name: 'An (đã đổi tên)' } }));

    expect(cachedCount()).toBe(4);
    expect(storeResetter).not.toHaveBeenCalled();
  });

  it('mount lần đầu khi đã đăng nhập ⇒ không xoá gì', () => {
    seedCaches();

    mount();

    expect(cachedCount()).toBe(4);
    expect(storeResetter).not.toHaveBeenCalled();
  });

  it('gỡ component KHÔNG xoá cache (rời cây component không có nghĩa là đổi người dùng)', () => {
    const view = mount();
    seedCaches();

    view.unmount();

    expect(cachedCount()).toBe(4);
    expect(storeResetter).not.toHaveBeenCalled();
  });
});
