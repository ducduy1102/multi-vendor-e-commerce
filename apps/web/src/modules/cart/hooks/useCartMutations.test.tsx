import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import { useAddToCart } from './useAddToCart';
import { useRemoveCartItem } from './useRemoveCartItem';
import { useUpdateCartItem } from './useUpdateCartItem';

vi.mock('../services/cart.service', () => ({
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

const USER = {
  id: 'user-1',
  email: 'a@example.com',
  name: 'A',
  role: 'USER' as const,
  emailVerifiedAt: null,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

function loginAs(user: typeof USER | null) {
  act(() => {
    useAuthStore.setState({ user, isHydrating: false });
  });
}

describe('mutation giỏ hàng', () => {
  beforeEach(() => {
    vi.mocked(cartService.addCartItem).mockReset().mockResolvedValue({
      id: 'i1',
      productVariantId: 'v1',
      quantity: 1,
    });
    vi.mocked(cartService.updateCartItem).mockReset().mockResolvedValue({
      id: 'i1',
      productVariantId: 'v1',
      quantity: 1,
    });
    vi.mocked(cartService.removeCartItem).mockReset().mockResolvedValue();
  });

  afterEach(() => {
    act(() => {
      useAuthStore.setState({ user: null, isHydrating: true });
      useCartStore.setState({ items: [], hasHydrated: false });
    });
  });

  describe('useAddToCart', () => {
    it('đã đăng nhập — gọi API, KHÔNG ghi vào store guest, rồi invalidate giỏ', async () => {
      loginAs(USER);
      const { wrapper, invalidate } = setup();
      const { result } = renderHook(() => useAddToCart(), { wrapper });

      await act(() => result.current.mutateAsync({ productVariantId: 'v1', quantity: 2 }));

      expect(cartService.addCartItem).toHaveBeenCalledWith({
        productVariantId: 'v1',
        quantity: 2,
      });
      expect(useCartStore.getState().items).toEqual([]);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    });

    it('guest — ghi vào store (cộng dồn), KHÔNG gọi API', async () => {
      loginAs(null);
      const { wrapper } = setup();
      const { result } = renderHook(() => useAddToCart(), { wrapper });

      await act(() => result.current.mutateAsync({ productVariantId: 'v1', quantity: 2 }));
      await act(() => result.current.mutateAsync({ productVariantId: 'v1', quantity: 3 }));

      expect(cartService.addCartItem).not.toHaveBeenCalled();
      expect(useCartStore.getState().items).toEqual([{ productVariantId: 'v1', quantity: 5 }]);
    });

    it('API báo lỗi (vd 409 vượt tồn kho) — mutation lỗi với message của BE, không invalidate', async () => {
      loginAs(USER);
      vi.mocked(cartService.addCartItem).mockRejectedValue(
        new ApiError('Quantity exceeds available stock (3)', 409),
      );
      const { wrapper, invalidate } = setup();
      const { result } = renderHook(() => useAddToCart(), { wrapper });

      act(() => {
        result.current.mutate({ productVariantId: 'v1', quantity: 9 });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Quantity exceeds available stock (3)');
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('chọn nhánh theo user TẠI THỜI ĐIỂM GỌI, không theo lúc render', async () => {
      loginAs(null);
      const { wrapper } = setup();
      const { result } = renderHook(() => useAddToCart(), { wrapper });

      loginAs(USER); // đăng nhập sau khi hook đã render
      await act(() => result.current.mutateAsync({ productVariantId: 'v1', quantity: 1 }));

      expect(cartService.addCartItem).toHaveBeenCalled();
      expect(useCartStore.getState().items).toEqual([]);
    });
  });

  describe('useUpdateCartItem', () => {
    it('đã đăng nhập — PATCH theo itemId', async () => {
      loginAs(USER);
      const { wrapper, invalidate } = setup();
      const { result } = renderHook(() => useUpdateCartItem(), { wrapper });

      await act(() =>
        result.current.mutateAsync({ itemId: 'i1', productVariantId: 'v1', quantity: 4 }),
      );

      expect(cartService.updateCartItem).toHaveBeenCalledWith('i1', 4);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    });

    it('đã đăng nhập nhưng thiếu itemId — lỗi rõ ràng, không gọi API', async () => {
      loginAs(USER);
      const { wrapper } = setup();
      const { result } = renderHook(() => useUpdateCartItem(), { wrapper });

      await expect(
        act(() =>
          result.current.mutateAsync({ itemId: null, productVariantId: 'v1', quantity: 1 }),
        ),
      ).rejects.toThrow('itemId');
      expect(cartService.updateCartItem).not.toHaveBeenCalled();
    });

    it('guest — đặt số lượng trong store theo productVariantId, KHÔNG gọi API', async () => {
      loginAs(null);
      act(() => {
        useCartStore.getState().addItem('v1', 5);
      });
      const { wrapper } = setup();
      const { result } = renderHook(() => useUpdateCartItem(), { wrapper });

      await act(() =>
        result.current.mutateAsync({ itemId: null, productVariantId: 'v1', quantity: 2 }),
      );

      expect(cartService.updateCartItem).not.toHaveBeenCalled();
      expect(useCartStore.getState().items).toEqual([{ productVariantId: 'v1', quantity: 2 }]);
    });
  });

  describe('useRemoveCartItem', () => {
    it('đã đăng nhập — DELETE theo itemId', async () => {
      loginAs(USER);
      const { wrapper, invalidate } = setup();
      const { result } = renderHook(() => useRemoveCartItem(), { wrapper });

      await act(() => result.current.mutateAsync({ itemId: 'i1', productVariantId: 'v1' }));

      expect(cartService.removeCartItem).toHaveBeenCalledWith('i1');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    });

    it('đã đăng nhập nhưng thiếu itemId — lỗi rõ ràng, không gọi API', async () => {
      loginAs(USER);
      const { wrapper } = setup();
      const { result } = renderHook(() => useRemoveCartItem(), { wrapper });

      await expect(
        act(() => result.current.mutateAsync({ itemId: null, productVariantId: 'v1' })),
      ).rejects.toThrow('itemId');
      expect(cartService.removeCartItem).not.toHaveBeenCalled();
    });

    it('guest — bỏ khỏi store theo productVariantId, KHÔNG gọi API', async () => {
      loginAs(null);
      act(() => {
        useCartStore.getState().addItem('v1');
        useCartStore.getState().addItem('v2');
      });
      const { wrapper } = setup();
      const { result } = renderHook(() => useRemoveCartItem(), { wrapper });

      await act(() => result.current.mutateAsync({ itemId: null, productVariantId: 'v1' }));

      expect(cartService.removeCartItem).not.toHaveBeenCalled();
      expect(useCartStore.getState().items).toEqual([{ productVariantId: 'v2', quantity: 1 }]);
    });
  });
});
