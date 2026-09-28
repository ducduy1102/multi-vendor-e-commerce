import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import type { CartView } from '../types';
import { useCart } from './useCart';
import { useCartCount } from './useCartCount';

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

function cartView(itemCount: number): CartView {
  return {
    shops: [],
    subtotal: '0',
    discount: null,
    grandTotal: '0',
    itemCount,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
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

describe('useCartCount', () => {
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

  it('auth còn đang hydrate -> null (chưa biết), không gọi API', () => {
    setAuth(null, true);
    setGuestCart([{ productVariantId: 'v1', quantity: 2 }]);

    const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

    expect(result.current).toBeNull();
    expect(cartService.getCart).not.toHaveBeenCalled();
  });

  describe('guest', () => {
    it('giỏ localStorage chưa hydrate -> null, không hiện số 0 sai', () => {
      setAuth(null);
      setGuestCart([], false);

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      expect(result.current).toBeNull();
    });

    it('đếm số sản phẩm khác nhau (số dòng) trong store, KHÔNG gọi mạng', () => {
      setAuth(null);
      setGuestCart([
        { productVariantId: 'v1', quantity: 2 },
        { productVariantId: 'v2', quantity: 3 },
      ]);

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      expect(result.current).toBe(2);
      expect(cartService.quoteCart).not.toHaveBeenCalled();
      expect(cartService.getCart).not.toHaveBeenCalled();
    });

    // Regression: badge từng cộng số lượng nên 1 sản phẩm x16 hiện 16 — sai với
    // các sàn thực tế (Shopee/Lazada đếm số sản phẩm khác nhau).
    it('1 sản phẩm số lượng 16 -> badge là 1, không phải 16', () => {
      setAuth(null);
      setGuestCart([{ productVariantId: 'v1', quantity: 16 }]);

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      expect(result.current).toBe(1);
    });

    it('giỏ trống -> 0', () => {
      setAuth(null);
      setGuestCart([]);

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      expect(result.current).toBe(0);
    });

    it('cập nhật ngay khi store đổi: thêm sản phẩm KHÁC thì tăng, thêm cùng sản phẩm thì giữ nguyên', () => {
      setAuth(null);
      setGuestCart([{ productVariantId: 'v1', quantity: 1 }]);
      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });
      expect(result.current).toBe(1);

      act(() => {
        useCartStore.getState().addItem('v1', 4);
      });
      expect(result.current).toBe(1);

      act(() => {
        useCartStore.getState().addItem('v2', 1);
      });
      expect(result.current).toBe(2);
    });
  });

  describe('user đã đăng nhập', () => {
    it('lấy itemCount từ giỏ BE; null trong lúc đang tải lần đầu', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView(7));

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      expect(result.current).toBeNull();
      await waitFor(() => expect(result.current).toBe(7));
      expect(cartService.getCart).toHaveBeenCalledWith(undefined);
    });

    it('bỏ qua giỏ guest còn sót trong store', async () => {
      setAuth(USER);
      setGuestCart([{ productVariantId: 'v-guest', quantity: 9 }]);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView(2));

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current).toBe(2));
    });

    it('lỗi tải giỏ -> vẫn null (không hiện số sai), không ném lỗi ra UI', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockRejectedValue(new ApiError('Unauthorized', 401));

      const { result } = renderHook(() => useCartCount(), { wrapper: createWrapper() });

      await waitFor(() => expect(cartService.getCart).toHaveBeenCalled());
      expect(result.current).toBeNull();
    });

    it('dùng chung cache với useCart: cả hai cùng render chỉ gọi 1 request', async () => {
      setAuth(USER);
      vi.mocked(cartService.getCart).mockResolvedValue(cartView(3));

      const { result } = renderHook(() => ({ count: useCartCount(), cart: useCart() }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.count).toBe(3));
      await waitFor(() => expect(result.current.cart.isPending).toBe(false));
      expect(cartService.getCart).toHaveBeenCalledTimes(1);
      expect(result.current.cart.cart?.itemCount).toBe(3);
    });
  });
});
