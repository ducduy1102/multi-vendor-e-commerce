import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import type { CartView } from '../types';
import { EMPTY_CART_VIEW, useCart } from './useCart';

vi.mock('../services/cart.service', () => ({
  getCart: vi.fn(),
  quoteCart: vi.fn(),
}));

const USER = {
  id: 'user-1',
  email: 'a@example.com',
  name: 'A',
  role: 'USER' as const,
  emailVerifiedAt: null,
};

function cartView(overrides: Partial<CartView> = {}): CartView {
  return {
    shops: [],
    subtotal: '100000',
    discount: null,
    grandTotal: '100000',
    itemCount: 1,
    ...overrides,
  };
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function setAuth(user: typeof USER | null, isHydrating = false) {
  act(() => {
    useAuthStore.setState({ user, isHydrating });
  });
}

function setGuestCart(
  items: Array<{ productVariantId: string; quantity: number }>,
  hasHydrated = true,
) {
  act(() => {
    useCartStore.setState({ items, hasHydrated });
  });
}

describe('useCart', () => {
  beforeEach(() => {
    vi.mocked(cartService.getCart).mockReset();
    vi.mocked(cartService.quoteCart).mockReset();
  });

  afterEach(() => {
    act(() => {
      useAuthStore.setState({ user: null, isHydrating: true });
      useCartStore.setState({ items: [], hasHydrated: false });
    });
  });

  describe('chờ hydrate', () => {
    it('auth đang hydrate — pending, chưa gọi API nào', () => {
      setAuth(null, true);
      setGuestCart([{ productVariantId: 'v1', quantity: 1 }]);

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      expect(result.current.isPending).toBe(true);
      expect(result.current.cart).toBeUndefined();
      expect(cartService.getCart).not.toHaveBeenCalled();
      expect(cartService.quoteCart).not.toHaveBeenCalled();
    });

    it('guest nhưng giỏ localStorage chưa hydrate — pending, không trả giỏ trống giả', () => {
      setAuth(null);
      setGuestCart([], false);

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      expect(result.current.isPending).toBe(true);
      expect(result.current.cart).toBeUndefined();
    });
  });

  describe('nhánh user đã đăng nhập', () => {
    it('gọi getCart (không gọi quote), trả CartView', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.cart).toEqual(cartView());
      expect(cartService.getCart).toHaveBeenCalledWith(undefined);
      expect(cartService.quoteCart).not.toHaveBeenCalled();
    });

    it('bỏ qua giỏ guest trong store khi đã đăng nhập', async () => {
      setAuth(USER);
      setGuestCart([{ productVariantId: 'v-guest', quantity: 9 }]);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(cartService.quoteCart).not.toHaveBeenCalled();
    });

    it('không cần hasHydrated của giỏ guest để tải giỏ user', async () => {
      setAuth(USER);
      setGuestCart([], false);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.cart).toBeDefined();
    });

    it('lỗi 401 — isError, không thử lại vô ích', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockRejectedValue(new ApiError('Unauthorized', 401));

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(cartService.getCart).toHaveBeenCalledTimes(1);
    });

    it('lỗi 500 — thử lại rồi báo isError', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockRejectedValue(new ApiError('boom', 500));

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(vi.mocked(cartService.getCart).mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('nhánh guest', () => {
    it('giỏ trống — trả giỏ rỗng ngay, KHÔNG gọi BE', () => {
      setAuth(null);
      setGuestCart([]);

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      expect(result.current.isPending).toBe(false);
      expect(result.current.cart).toEqual(EMPTY_CART_VIEW);
      expect(cartService.quoteCart).not.toHaveBeenCalled();
      expect(cartService.getCart).not.toHaveBeenCalled();
    });

    it('có item — gọi quoteCart với items từ store (không gọi getCart)', async () => {
      const items = [{ productVariantId: 'v1', quantity: 2 }];
      setAuth(null);
      setGuestCart(items);
      vi.mocked(cartService.quoteCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(cartService.quoteCart).toHaveBeenCalledWith(items, undefined);
      expect(cartService.getCart).not.toHaveBeenCalled();
      expect(result.current.cart).toEqual(cartView());
    });

    it('cùng shape CartView với nhánh user', async () => {
      const view = cartView({ itemCount: 3 });
      setAuth(null);
      setGuestCart([{ productVariantId: 'v1', quantity: 3 }]);
      vi.mocked(cartService.quoteCart).mockResolvedValue(view);

      const guest = renderHook(() => useCart(), { wrapper: wrapper() });
      await waitFor(() => expect(guest.result.current.cart).toEqual(view));

      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(view);
      const user = renderHook(() => useCart(), { wrapper: wrapper() });
      await waitFor(() => expect(user.result.current.cart).toEqual(view));
    });

    it('đổi số lượng trong store — tự lấy lại giỏ với items mới', async () => {
      setAuth(null);
      setGuestCart([{ productVariantId: 'v1', quantity: 1 }]);
      vi.mocked(cartService.quoteCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.isPending).toBe(false));

      setGuestCart([{ productVariantId: 'v1', quantity: 4 }]);

      await waitFor(() =>
        expect(cartService.quoteCart).toHaveBeenLastCalledWith(
          [{ productVariantId: 'v1', quantity: 4 }],
          undefined,
        ),
      );
    });

    it('xoá hết item — về giỏ rỗng, không gọi BE thêm', async () => {
      setAuth(null);
      setGuestCart([{ productVariantId: 'v1', quantity: 1 }]);
      vi.mocked(cartService.quoteCart).mockResolvedValue(cartView());

      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.isPending).toBe(false));
      const callsBefore = vi.mocked(cartService.quoteCart).mock.calls.length;

      setGuestCart([]);

      await waitFor(() => expect(result.current.cart).toEqual(EMPTY_CART_VIEW));
      expect(vi.mocked(cartService.quoteCart).mock.calls.length).toBe(callsBefore);
    });
  });

  describe('voucher', () => {
    it('mã hợp lệ — truyền mã (đã trim) xuống service, trả discount, voucherError null', async () => {
      const view = cartView({
        discount: { code: 'SALE10', shopId: null, amount: '10000' },
        grandTotal: '90000',
      });
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(view);

      const { result } = renderHook(() => useCart('  SALE10 '), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(cartService.getCart).toHaveBeenCalledWith('SALE10');
      expect(result.current.cart?.discount?.amount).toBe('10000');
      expect(result.current.voucherError).toBeNull();
    });

    it('mã bị từ chối (400) — vẫn trả giỏ KHÔNG mã + lý do của BE, không làm hỏng cả trang', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockImplementation((code) =>
        code
          ? Promise.reject(new ApiError('Voucher has expired', 400))
          : Promise.resolve(cartView()),
      );

      const { result } = renderHook(() => useCart('OLD'), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.isError).toBe(false);
      expect(result.current.cart).toEqual(cartView());
      expect(result.current.voucherError).toBe('Voucher has expired');
    });

    it('mã không tồn tại (404) — cũng chỉ là lỗi voucher', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockImplementation((code) =>
        code ? Promise.reject(new ApiError('Voucher not found', 404)) : Promise.resolve(cartView()),
      );

      const { result } = renderHook(() => useCart('NOPE'), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.voucherError).toBe('Voucher not found'));
      expect(result.current.cart).toBeDefined();
    });

    it('nhánh guest cũng xử lý mã sai giống nhánh user', async () => {
      const items = [{ productVariantId: 'v1', quantity: 1 }];
      setAuth(null);
      setGuestCart(items);
      vi.mocked(cartService.quoteCart).mockImplementation((_items, code) =>
        code
          ? Promise.reject(new ApiError('Voucher is not active', 400))
          : Promise.resolve(cartView()),
      );

      const { result } = renderHook(() => useCart('OFF'), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.voucherError).toBe('Voucher is not active'));
      expect(result.current.cart).toEqual(cartView());
    });

    it('lỗi khác 400/404 khi có mã (vd 500) — vẫn là lỗi cả query, không nuốt', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockRejectedValue(new ApiError('boom', 500));

      const { result } = renderHook(() => useCart('SALE10'), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.voucherError).toBeNull();
    });

    it('guest giỏ trống nhập mã — không gọi BE, không có voucherError', () => {
      setAuth(null);
      setGuestCart([]);

      const { result } = renderHook(() => useCart('SALE10'), { wrapper: wrapper() });

      expect(result.current.voucherError).toBeNull();
      expect(cartService.quoteCart).not.toHaveBeenCalled();
    });
  });

  describe('cô lập dữ liệu giữa các phiên', () => {
    it('đăng xuất — giỏ của user cũ không hiện sang guest có item', async () => {
      const userView = cartView({ itemCount: 7 });
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(userView);
      const Wrapper = wrapper();

      const { result } = renderHook(() => useCart(), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.cart).toEqual(userView));

      vi.mocked(cartService.quoteCart).mockReturnValue(new Promise(() => {}));
      setGuestCart([{ productVariantId: 'v-new', quantity: 1 }]);
      setAuth(null);

      expect(result.current.cart).toBeUndefined();
      expect(result.current.isPending).toBe(true);
    });

    it('đổi sang user khác — không mượn giỏ của user trước', async () => {
      const first = cartView({ itemCount: 1 });
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(first);
      const { result } = renderHook(() => useCart(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.cart).toEqual(first));

      vi.mocked(cartService.getCart).mockReturnValue(new Promise(() => {}));
      setAuth({ ...USER, id: 'user-2' });

      expect(result.current.cart).toBeUndefined();
    });
  });
});
