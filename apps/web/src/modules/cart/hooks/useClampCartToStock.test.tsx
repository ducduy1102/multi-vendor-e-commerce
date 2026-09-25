import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CartLine, CartShopGroup, CartView } from '../types';
import { useClampCartToStock } from './useClampCartToStock';
import { useUpdateCartItem } from './useUpdateCartItem';

const toastInfo = vi.fn();

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfo(...args) },
}));
vi.mock('./useUpdateCartItem', () => ({ useUpdateCartItem: vi.fn() }));

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'item-1',
    productVariantId: 'v1',
    quantity: 2,
    productId: 'p1',
    productName: 'Áo',
    productSlug: 'ao',
    imageUrl: null,
    attributes: [],
    unitPrice: '100000',
    lineTotal: '200000',
    stock: 10,
    isAvailable: true,
    ...overrides,
  };
}

function cartOf(...lines: CartLine[]): CartView {
  const group: CartShopGroup = {
    shopId: 's1',
    shopName: 'Shop',
    shopSlug: 'shop',
    items: lines,
    subtotal: '0',
  };
  return {
    shops: [group],
    subtotal: '0',
    discount: null,
    grandTotal: '0',
    itemCount: lines.length,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return withIntl(<>{children}</>);
}

describe('useClampCartToStock', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastInfo.mockReset();
    mutateAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useUpdateCartItem).mockReturnValue({
      mutateAsync,
    } as unknown as ReturnType<typeof useUpdateCartItem>);
  });

  it('chưa có giỏ -> không làm gì', () => {
    renderHook(() => useClampCartToStock(undefined), { wrapper });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('số lượng không vượt kho (kể cả đúng bằng kho) -> không đụng tới', () => {
    renderHook(
      () =>
        useClampCartToStock(
          cartOf(
            line({ productVariantId: 'a', quantity: 3, stock: 10 }),
            line({ productVariantId: 'b', quantity: 5, stock: 5 }),
          ),
        ),
      { wrapper },
    );

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('vượt kho (16 > 15) -> hạ về đúng tồn kho, kèm thông báo', async () => {
    renderHook(() => useClampCartToStock(cartOf(line({ id: 'item-9', quantity: 16, stock: 15 }))), {
      wrapper,
    });

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        itemId: 'item-9',
        productVariantId: 'v1',
        quantity: 15,
      }),
    );
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(
        'Đã điều chỉnh số lượng của 1 sản phẩm theo tồn kho hiện có',
      ),
    );
  });

  it('giỏ guest (id null) -> vẫn truyền productVariantId để hook cập nhật ghi vào store', async () => {
    renderHook(() => useClampCartToStock(cartOf(line({ id: null, quantity: 4, stock: 2 }))), {
      wrapper,
    });

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        itemId: null,
        productVariantId: 'v1',
        quantity: 2,
      }),
    );
  });

  it('nhiều dòng vượt kho -> hạ từng dòng, chỉ 1 thông báo gộp', async () => {
    renderHook(
      () =>
        useClampCartToStock(
          cartOf(
            line({ id: 'i1', productVariantId: 'a', quantity: 9, stock: 3 }),
            line({ id: 'i2', productVariantId: 'b', quantity: 8, stock: 4 }),
            line({ id: 'i3', productVariantId: 'c', quantity: 1, stock: 4 }),
          ),
        ),
      { wrapper },
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(
        'Đã điều chỉnh số lượng của 2 sản phẩm theo tồn kho hiện có',
      ),
    );
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  it('hết hàng hẳn (stock 0) -> KHÔNG đổi số lượng, để người dùng tự quyết', () => {
    renderHook(() => useClampCartToStock(cartOf(line({ quantity: 3, stock: 0 }))), { wrapper });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('item không khả dụng -> bỏ qua dù số lượng lớn hơn tồn kho', () => {
    renderHook(
      () => useClampCartToStock(cartOf(line({ isAvailable: false, quantity: 9, stock: 2 }))),
      { wrapper },
    );

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('render lại với cùng giỏ (vd đang tải lại) -> không gọi trùng', async () => {
    const overStock = cartOf(line({ quantity: 16, stock: 15 }));
    const { rerender } = renderHook(({ cart }) => useClampCartToStock(cart), {
      wrapper,
      initialProps: { cart: overStock as CartView | undefined },
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    rerender({ cart: cartOf(line({ quantity: 16, stock: 15 })) });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('cập nhật lỗi -> KHÔNG thử lại vô hạn và KHÔNG báo "đã điều chỉnh"', async () => {
    mutateAsync.mockRejectedValue(new Error('network'));
    const { rerender } = renderHook(({ cart }) => useClampCartToStock(cart), {
      wrapper,
      initialProps: { cart: cartOf(line({ quantity: 16, stock: 15 })) as CartView | undefined },
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ cart: cartOf(line({ quantity: 16, stock: 15 })) });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('một dòng lỗi, một dòng thành công -> chỉ đếm dòng đã điều chỉnh được', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined);
    renderHook(
      () =>
        useClampCartToStock(
          cartOf(
            line({ id: 'i1', productVariantId: 'a', quantity: 9, stock: 3 }),
            line({ id: 'i2', productVariantId: 'b', quantity: 8, stock: 4 }),
          ),
        ),
      { wrapper },
    );

    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(
        'Đã điều chỉnh số lượng của 1 sản phẩm theo tồn kho hiện có',
      ),
    );
  });

  it('sau khi đã hạ xuống, nếu kho lại giảm thêm -> hạ tiếp lần nữa (khoá theo cả số lượng/tồn kho)', async () => {
    const { rerender } = renderHook(({ cart }) => useClampCartToStock(cart), {
      wrapper,
      initialProps: { cart: cartOf(line({ quantity: 16, stock: 15 })) as CartView | undefined },
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    rerender({ cart: cartOf(line({ quantity: 15, stock: 10 })) });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: 'item-1',
      productVariantId: 'v1',
      quantity: 10,
    });
  });
});
