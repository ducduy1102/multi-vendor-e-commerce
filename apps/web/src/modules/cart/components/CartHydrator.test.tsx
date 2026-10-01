import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { withIntl } from '@/shared/lib/test-i18n';

import * as cartService from '../services/cart.service';
import { CART_STORAGE_KEY, useCartStore } from '../store/cart.store';
import { CartHydrator } from './CartHydrator';

const toastInfo = vi.fn();

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfo(...args) },
}));

vi.mock('../services/cart.service', () => ({
  mergeCart: vi.fn(),
}));

const USER = {
  id: 'user-1',
  email: 'a@example.com',
  name: 'A',
  role: 'USER' as const,
  emailVerifiedAt: null,
};

const GUEST_ITEMS = [
  { productVariantId: 'v1', quantity: 2 },
  { productVariantId: 'v2', quantity: 1 },
];

const EMPTY_VIEW = {
  shops: [],
  subtotal: '0',
  discount: null,
  grandTotal: '0',
  itemCount: 0,
};

function saveGuestCart(items: typeof GUEST_ITEMS) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ state: { items }, version: 0 }));
}

function renderHydrator(strict = false) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const tree = withIntl(
    <QueryClientProvider client={queryClient}>
      <CartHydrator />
    </QueryClientProvider>,
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { invalidate };
}

function setAuth(user: typeof USER | null, isHydrating = false) {
  act(() => {
    useAuthStore.setState({ user, isHydrating });
  });
}

describe('CartHydrator', () => {
  beforeEach(() => {
    toastInfo.mockReset();
    vi.mocked(cartService.mergeCart)
      .mockReset()
      .mockResolvedValue({ cart: EMPTY_VIEW, droppedLineCount: 0 });
  });

  afterEach(() => {
    localStorage.clear();
    act(() => {
      useAuthStore.setState({ user: null, isHydrating: true });
      useCartStore.setState({ items: [], hasHydrated: false });
    });
  });

  it('mount — đọc giỏ guest từ localStorage vào store và bật hasHydrated', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(null);

    renderHydrator();

    await waitFor(() => expect(useCartStore.getState().hasHydrated).toBe(true));
    expect(useCartStore.getState().items).toEqual(GUEST_ITEMS);
  });

  it('guest chưa đăng nhập — KHÔNG merge, giữ nguyên giỏ guest', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(null);

    renderHydrator();

    await waitFor(() => expect(useCartStore.getState().hasHydrated).toBe(true));
    expect(cartService.mergeCart).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toEqual(GUEST_ITEMS);
  });

  it('auth còn đang hydrate — chưa merge (chưa biết chắc đã đăng nhập hay chưa)', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(USER, true);

    renderHydrator();

    await waitFor(() => expect(useCartStore.getState().hasHydrated).toBe(true));
    expect(cartService.mergeCart).not.toHaveBeenCalled();
  });

  it('đăng nhập + có giỏ guest — merge đúng items, clear store, làm mới giỏ', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(null);
    const { invalidate } = renderHydrator();
    await waitFor(() => expect(useCartStore.getState().hasHydrated).toBe(true));

    setAuth(USER);

    await waitFor(() => expect(cartService.mergeCart).toHaveBeenCalledWith(GUEST_ITEMS));
    await waitFor(() => expect(useCartStore.getState().items).toEqual([]));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    // localStorage cũng được dọn (persist ghi lại giỏ trống)
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}')).toMatchObject({
      state: { items: [] },
    });
    // droppedLineCount = 0 (mặc định mock) -> không có gì để báo.
    expect(toastInfo).not.toHaveBeenCalled();
  });

  // Week7.md 3.5/1.12: giỏ DB đã đủ MAX_CART_LINES nên BE bỏ bớt vài dòng của giỏ guest khi gộp
  // (Week6.md 3.4 để ngỏ, làm ở đây) — CartHydrator phải báo đúng số dòng bị bỏ.
  it('gộp giỏ bị bỏ bớt dòng do vượt trần MAX_CART_LINES -> hiện toast báo đúng số dòng', async () => {
    saveGuestCart(GUEST_ITEMS);
    vi.mocked(cartService.mergeCart).mockResolvedValue({ cart: EMPTY_VIEW, droppedLineCount: 3 });
    setAuth(USER);

    renderHydrator();

    await waitFor(() => expect(useCartStore.getState().items).toEqual([]));
    expect(toastInfo).toHaveBeenCalledWith(
      '3 sản phẩm từ giỏ trước không được gộp vào vì giỏ đã đạt tối đa 50 sản phẩm khác nhau',
    );
  });

  it('đã đăng nhập sẵn (F5) mà còn sót giỏ guest — vẫn merge', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(USER);

    renderHydrator();

    await waitFor(() => expect(cartService.mergeCart).toHaveBeenCalledWith(GUEST_ITEMS));
  });

  it('đăng nhập nhưng giỏ guest trống — không gọi API merge', async () => {
    setAuth(USER);

    renderHydrator();

    await waitFor(() => expect(useCartStore.getState().hasHydrated).toBe(true));
    expect(cartService.mergeCart).not.toHaveBeenCalled();
  });

  it('merge lỗi — GIỮ NGUYÊN giỏ guest, không mất hàng của người dùng', async () => {
    saveGuestCart(GUEST_ITEMS);
    vi.mocked(cartService.mergeCart).mockRejectedValue(new Error('network'));
    setAuth(USER);

    const { invalidate } = renderHydrator();

    await waitFor(() => expect(cartService.mergeCart).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(useCartStore.getState().items).toEqual(GUEST_ITEMS);
    expect(invalidate).not.toHaveBeenCalled();
  });

  // rules/frontend.md mục 8: effect có tác dụng phụ không lặp lại an toàn phải
  // tự chặn gọi trùng và có regression test bọc <StrictMode> thật — POST
  // /cart/merge cộng dồn số lượng nên gọi 2 lần sẽ nhân đôi giỏ.
  it('StrictMode — chỉ gọi merge đúng 1 lần dù effect chạy 2 lần', async () => {
    // Store đã hydrate sẵn + user đã có ngay lúc mount (vd layout remount khi
    // đổi locale mà lần merge trước lỗi nên còn sót giỏ) — đúng tình huống
    // mà effect merge chạy ngay trong lượt mount kép của StrictMode. Nếu để
    // hasHydrated=false thì cả 2 lượt đều bị bỏ qua và test không bắt được lỗi.
    setAuth(USER);
    act(() => {
      useCartStore.setState({ items: GUEST_ITEMS, hasHydrated: true });
    });

    renderHydrator(true);

    await waitFor(() => expect(cartService.mergeCart).toHaveBeenCalled());
    await waitFor(() => expect(useCartStore.getState().items).toEqual([]));
    expect(cartService.mergeCart).toHaveBeenCalledTimes(1);
  });

  it('đăng xuất rồi đăng nhập lại với giỏ guest mới — merge thêm lần nữa', async () => {
    saveGuestCart(GUEST_ITEMS);
    setAuth(USER);
    renderHydrator();
    await waitFor(() => expect(useCartStore.getState().items).toEqual([]));

    setAuth(null);
    act(() => {
      useCartStore.getState().addItem('v3', 1);
    });
    setAuth(USER);

    await waitFor(() => expect(cartService.mergeCart).toHaveBeenCalledTimes(2));
    expect(cartService.mergeCart).toHaveBeenLastCalledWith([
      { productVariantId: 'v3', quantity: 1 },
    ]);
  });
});
