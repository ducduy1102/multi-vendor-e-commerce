import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshSession } from '@/shared/lib/session-refresh';

import { useAuthStore } from '../store/auth.store';
import { AuthHydrator } from './AuthHydrator';

vi.mock('../services/auth.service', () => ({
  me: vi.fn(),
}));

// Router/pathname của next-intl cần provider + Next router thật — thay bằng bản giả đủ cho hành vi cần kiểm
// (điều hướng khi mất phiên). `usePathname` của next-intl trả đường dẫn ĐÃ bỏ prefix locale.
const navigation = vi.hoisted(() => ({
  pathname: '/',
  replace: vi.fn(),
  refresh: vi.fn(),
  router: null as unknown as { replace: () => void; refresh: () => void },
}));
vi.mock('@/i18n/navigation', () => {
  navigation.router = { replace: navigation.replace, refresh: navigation.refresh };
  return {
    useRouter: () => navigation.router,
    usePathname: () => navigation.pathname,
  };
});

const mockUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

describe('AuthHydrator', () => {
  beforeEach(() => {
    navigation.pathname = '/';
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    useAuthStore.getState().clearUser();
    useAuthStore.getState().setIsHydrating(true);
    vi.resetAllMocks();
  });

  it('sets the user in store when /auth/me resolves', async () => {
    const { me } = await import('../services/auth.service');
    vi.mocked(me).mockResolvedValue(mockUser);

    render(<AuthHydrator />);

    await waitFor(() => expect(useAuthStore.getState().user).toEqual(mockUser));
  });

  it('keeps user as null when /auth/me rejects (chưa đăng nhập)', async () => {
    const { me } = await import('../services/auth.service');
    vi.mocked(me).mockRejectedValue(new Error('Unauthorized'));

    render(<AuthHydrator />);

    await waitFor(() => expect(vi.mocked(me)).toHaveBeenCalled());
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('keeps isHydrating true until /auth/me resolves, then sets it false', async () => {
    const { me } = await import('../services/auth.service');
    let resolveMe!: (user: typeof mockUser) => void;
    vi.mocked(me).mockReturnValue(
      new Promise((resolve) => {
        resolveMe = resolve;
      }),
    );

    render(<AuthHydrator />);

    expect(useAuthStore.getState().isHydrating).toBe(true);

    resolveMe(mockUser);

    await waitFor(() => expect(useAuthStore.getState().isHydrating).toBe(false));
  });

  it('sets isHydrating to false when /auth/me rejects with 401 (chưa đăng nhập)', async () => {
    const { me } = await import('../services/auth.service');
    vi.mocked(me).mockRejectedValue(new Error('Unauthorized'));

    render(<AuthHydrator />);

    await waitFor(() => expect(useAuthStore.getState().isHydrating).toBe(false));
  });

  it('sets isHydrating to false when /auth/me rejects with a network error', async () => {
    const { me } = await import('../services/auth.service');
    vi.mocked(me).mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AuthHydrator />);

    await waitFor(() => expect(useAuthStore.getState().isHydrating).toBe(false));
  });

  // Mất phiên = lần gia hạn bị BE từ chối (Week10.md 2.1). Giả lập bằng chính module gia hạn thật: handler
  // do AuthHydrator đăng ký sẽ được gọi khi callRefresh trả 'rejected'.
  describe('mất phiên (gia hạn bị từ chối)', () => {
    async function renderSignedIn() {
      const { me } = await import('../services/auth.service');
      vi.mocked(me).mockResolvedValue(mockUser);
      const view = render(<AuthHydrator />);
      await waitFor(() => expect(useAuthStore.getState().user).toEqual(mockUser));
      return view;
    }

    const loseSession = () => refreshSession(() => Promise.resolve('rejected'));

    it('xoá user khỏi store và đưa về /login?next=<trang hiện tại> khi đang ở route cần đăng nhập', async () => {
      navigation.pathname = '/orders';
      await renderSignedIn();

      await loseSession();

      expect(useAuthStore.getState().user).toBeNull();
      expect(navigation.replace).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Forders');
      expect(navigation.refresh).toHaveBeenCalledTimes(1);
    });

    it('giữ cả query của trang hiện tại trong ?next= (đăng nhập xong quay lại đúng tab/trang)', async () => {
      navigation.pathname = '/orders';
      window.history.pushState({}, '', '/orders?tab=pending');
      await renderSignedIn();

      await loseSession();

      expect(navigation.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/orders?tab=pending')}`,
      );
    });

    it('đang ở trang công khai -> chỉ xoá user, KHÔNG điều hướng (khách vẫn xem sản phẩm bình thường)', async () => {
      navigation.pathname = '/products';
      await renderSignedIn();

      await loseSession();

      expect(useAuthStore.getState().user).toBeNull();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('dùng đường dẫn HIỆN TẠI lúc mất phiên, không phải lúc mount', async () => {
      navigation.pathname = '/products';
      const { rerender } = await renderSignedIn();

      navigation.pathname = '/seller/products';
      rerender(<AuthHydrator />);
      await loseSession();

      expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Fseller%2Fproducts');
    });

    it('gỡ component thì gỡ luôn handler (không điều hướng/xoá store sau khi đã unmount)', async () => {
      navigation.pathname = '/orders';
      const { unmount } = await renderSignedIn();

      unmount();
      await loseSession();

      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(navigation.replace).not.toHaveBeenCalled();
    });
  });
});
