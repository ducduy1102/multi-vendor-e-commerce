import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useCart } from '../hooks/useCart';
import { useRemoveCartItem } from '../hooks/useRemoveCartItem';
import { useUpdateCartItem } from '../hooks/useUpdateCartItem';
import type { CartLine, CartShopGroup, CartView } from '../types';
import { CartPageContainer } from './CartPageContainer';

const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));
vi.mock('../hooks/useCart', () => ({ useCart: vi.fn() }));
vi.mock('../hooks/useUpdateCartItem', () => ({ useUpdateCartItem: vi.fn() }));
vi.mock('../hooks/useRemoveCartItem', () => ({ useRemoveCartItem: vi.fn() }));

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'item-1',
    productVariantId: 'v1',
    quantity: 2,
    productId: 'p1',
    productName: 'Áo thun nam',
    productSlug: 'ao-thun-nam',
    imageUrl: null,
    attributes: [{ name: 'Màu', value: 'Đỏ' }],
    unitPrice: '100000',
    lineTotal: '200000',
    stock: 10,
    isAvailable: true,
    ...overrides,
  };
}

function group(overrides: Partial<CartShopGroup> = {}): CartShopGroup {
  return {
    shopId: 'shop-a',
    shopName: 'Shop A',
    shopSlug: 'shop-a',
    items: [line()],
    subtotal: '200000',
    ...overrides,
  };
}

function cartView(overrides: Partial<CartView> = {}): CartView {
  return {
    shops: [group()],
    subtotal: '200000',
    discount: null,
    grandTotal: '200000',
    itemCount: 2,
    ...overrides,
  };
}

interface CartState {
  cart?: CartView;
  voucherError?: string | null;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  refetch?: () => void;
}

function mockCart(state: CartState) {
  const refetch = state.refetch ?? vi.fn();
  vi.mocked(useCart).mockReturnValue({
    cart: state.cart,
    voucherError: state.voucherError ?? null,
    isPending: state.isPending ?? false,
    isFetching: state.isFetching ?? false,
    isError: state.isError ?? false,
    error: null,
    refetch,
  } as unknown as ReturnType<typeof useCart>);
  return refetch;
}

type MutateOptions = { onError?: (error: Error) => void };

function mockMutations(failWith?: Error) {
  const update = vi.fn((_vars: unknown, options?: MutateOptions) => {
    if (failWith) options?.onError?.(failWith);
  });
  const remove = vi.fn();
  vi.mocked(useUpdateCartItem).mockReturnValue({
    mutate: update,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateCartItem>);
  vi.mocked(useRemoveCartItem).mockReturnValue({
    mutate: remove,
    isPending: false,
  } as unknown as ReturnType<typeof useRemoveCartItem>);
  return { update, remove };
}

function renderContainer() {
  return render(withIntl(<CartPageContainer />));
}

describe('CartPageContainer', () => {
  beforeEach(() => {
    toastError.mockReset();
    vi.mocked(useCart).mockReset();
    mockMutations();
  });

  describe('trạng thái', () => {
    it('đang tải -> skeleton, aria-busy và dòng sr-only, chưa hiện dữ liệu', () => {
      mockCart({ isPending: true });

      const { container } = renderContainer();

      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
      expect(screen.queryByText('Tóm tắt đơn hàng')).not.toBeInTheDocument();
    });

    it('lỗi -> thông báo role=alert, nút Thử lại gọi refetch', async () => {
      const refetch = mockCart({ isError: true });
      const user = userEvent.setup();
      renderContainer();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Không tải được giỏ hàng, vui lòng thử lại',
      );
      await user.click(screen.getByRole('button', { name: 'Thử lại' }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('giỏ trống -> thông báo + nút tiếp tục mua sắm trỏ tới /products', () => {
      mockCart({ cart: cartView({ shops: [], subtotal: '0', grandTotal: '0', itemCount: 0 }) });

      renderContainer();

      expect(screen.getByText('Giỏ hàng của bạn đang trống.')).toBeInTheDocument();
      // Button render={<Link/>} (nativeButton=false) có role="button", href vẫn ở thẻ <a>.
      expect(screen.getByRole('button', { name: 'Tiếp tục mua sắm' })).toHaveAttribute(
        'href',
        '/products',
      );
    });
  });

  describe('nhóm theo shop', () => {
    it('mỗi shop 1 khối riêng với subtotal riêng, kèm tổng cộng toàn giỏ', () => {
      mockCart({
        cart: cartView({
          shops: [
            group({ shopId: 'shop-a', shopName: 'Shop A', subtotal: '200000' }),
            group({
              shopId: 'shop-b',
              shopName: 'Shop B',
              items: [
                line({
                  id: 'item-2',
                  productVariantId: 'v2',
                  productName: 'Quần jean',
                  quantity: 1,
                  unitPrice: '500000',
                  lineTotal: '500000',
                }),
              ],
              subtotal: '500000',
            }),
          ],
          subtotal: '700000',
          grandTotal: '700000',
        }),
      });

      renderContainer();

      const shopA = screen.getByRole('region', { name: 'Shop A' });
      const shopB = screen.getByRole('region', { name: 'Shop B' });
      expect(within(shopA).getByText('Áo thun nam')).toBeInTheDocument();
      expect(within(shopA).queryByText('Quần jean')).not.toBeInTheDocument();
      expect(within(shopA).getByText('200.000 ₫', { selector: 'span' })).toBeInTheDocument();
      expect(within(shopB).getByText('Quần jean')).toBeInTheDocument();
      expect(within(shopB).getAllByText('500.000 ₫').length).toBeGreaterThan(0);

      const summary = screen.getByRole('complementary', { name: 'Tóm tắt đơn hàng' });
      expect(within(summary).getByText('Tạm tính').nextSibling).toHaveTextContent('700.000 ₫');
      expect(within(summary).getByText('Tổng cộng').nextSibling).toHaveTextContent('700.000 ₫');
    });

    it('hiện tên thuộc tính variant và link tới trang sản phẩm', () => {
      mockCart({ cart: cartView() });

      renderContainer();

      expect(screen.getByText('Màu: Đỏ')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Áo thun nam' })).toHaveAttribute(
        'href',
        '/products/ao-thun-nam',
      );
    });
  });

  describe('item', () => {
    it('không khả dụng -> badge Ngừng bán, KHÔNG có stepper nhưng vẫn xoá được', async () => {
      const { remove } = mockMutations();
      mockCart({ cart: cartView({ shops: [group({ items: [line({ isAvailable: false })] })] }) });
      const user = userEvent.setup();
      renderContainer();

      expect(screen.getByText('Ngừng bán')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Tăng số lượng' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Xoá Áo thun nam khỏi giỏ hàng' }));
      expect(remove).toHaveBeenCalledWith(
        { itemId: 'item-1', productVariantId: 'v1' },
        expect.any(Object),
      );
    });

    it('số lượng vượt tồn kho -> cảnh báo còn N, không cho tăng thêm', () => {
      mockCart({
        cart: cartView({ shops: [group({ items: [line({ quantity: 5, stock: 3 })] })] }),
      });

      renderContainer();

      expect(screen.getByText('Chỉ còn 3 sản phẩm')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
    });

    it('hết hàng (stock 0) -> cảnh báo hết hàng và khoá stepper', () => {
      mockCart({
        cart: cartView({ shops: [group({ items: [line({ quantity: 1, stock: 0 })] })] }),
      });

      renderContainer();

      expect(screen.getByText('Phân loại này đã hết hàng')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
    });

    it('tăng số lượng -> gọi cập nhật đúng itemId/variant/số mới', async () => {
      const { update } = mockMutations();
      mockCart({ cart: cartView() });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));

      expect(update).toHaveBeenCalledWith(
        { itemId: 'item-1', productVariantId: 'v1', quantity: 3 },
        expect.any(Object),
      );
    });

    it('giỏ guest (id null) -> vẫn truyền productVariantId để hook ghi vào store', async () => {
      const { update } = mockMutations();
      mockCart({ cart: cartView({ shops: [group({ items: [line({ id: null })] })] }) });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Giảm số lượng' }));

      expect(update).toHaveBeenCalledWith(
        { itemId: null, productVariantId: 'v1', quantity: 1 },
        expect.any(Object),
      );
    });

    it('cập nhật lỗi 409 -> toast đã dịch, không lộ message tiếng Anh của BE', async () => {
      mockMutations(new ApiError('Quantity exceeds available stock (3)', 409));
      mockCart({ cart: cartView() });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));

      expect(toastError).toHaveBeenCalledWith(
        'Không thể đổi số lượng: vượt tồn kho hoặc sản phẩm không còn bán',
      );
    });

    it('cập nhật lỗi khác -> toast lỗi chung', async () => {
      mockMutations(new Error('network'));
      mockCart({ cart: cartView() });
      const user = userEvent.setup();
      renderContainer();

      await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));

      expect(toastError).toHaveBeenCalledWith('Không cập nhật được số lượng, vui lòng thử lại');
    });

    it('đang có thao tác dở -> khoá stepper và nút xoá', () => {
      vi.mocked(useUpdateCartItem).mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useUpdateCartItem>);
      mockCart({ cart: cartView() });

      renderContainer();

      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Xoá Áo thun nam khỏi giỏ hàng' })).toBeDisabled();
    });
  });

  describe('voucher', () => {
    function lastCartArg() {
      const calls = vi.mocked(useCart).mock.calls;
      return calls[calls.length - 1][0];
    }

    it('nhập mã rồi bấm Áp dụng -> useCart nhận đúng mã đã trim', async () => {
      mockCart({ cart: cartView() });
      const user = userEvent.setup();
      renderContainer();
      expect(lastCartArg()).toBe('');

      await user.type(screen.getByLabelText('Mã giảm giá'), '  SALE10 ');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));

      expect(lastCartArg()).toBe('SALE10');
    });

    it('nút Áp dụng disabled khi ô nhập trống', () => {
      mockCart({ cart: cartView() });

      renderContainer();

      expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    });

    it('mã hợp lệ -> hiện dòng giảm giá, tổng sau giảm và mã đã áp', async () => {
      const user = userEvent.setup();
      mockCart({ cart: cartView() });
      const { rerender } = renderContainer();
      await user.type(screen.getByLabelText('Mã giảm giá'), 'SALE10');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));

      mockCart({
        cart: cartView({
          discount: { code: 'SALE10', shopId: null, amount: '20000' },
          grandTotal: '180000',
        }),
      });
      rerender(withIntl(<CartPageContainer />));

      const summary = screen.getByRole('complementary', { name: 'Tóm tắt đơn hàng' });
      expect(within(summary).getByText('Đã áp dụng mã SALE10')).toBeInTheDocument();
      expect(within(summary).getByText('Giảm giá').nextSibling).toHaveTextContent('-20.000 ₫');
      expect(within(summary).getByText('Tổng cộng').nextSibling).toHaveTextContent('180.000 ₫');
    });

    it('voucher của shop -> nói rõ áp cho shop nào', async () => {
      const user = userEvent.setup();
      mockCart({ cart: cartView() });
      const { rerender } = renderContainer();
      await user.type(screen.getByLabelText('Mã giảm giá'), 'SHOPA');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));

      mockCart({
        cart: cartView({
          discount: { code: 'SHOPA', shopId: 'shop-a', amount: '10000' },
          grandTotal: '190000',
        }),
      });
      rerender(withIntl(<CartPageContainer />));

      expect(screen.getByText('Đã áp dụng mã SHOPA cho Shop A')).toBeInTheDocument();
    });

    it('bỏ mã -> useCart quay về mã rỗng và xoá ô nhập', async () => {
      const user = userEvent.setup();
      mockCart({ cart: cartView() });
      const { rerender } = renderContainer();
      await user.type(screen.getByLabelText('Mã giảm giá'), 'SALE10');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
      mockCart({
        cart: cartView({ discount: { code: 'SALE10', shopId: null, amount: '20000' } }),
      });
      rerender(withIntl(<CartPageContainer />));

      await user.click(screen.getByRole('button', { name: 'Bỏ mã' }));

      expect(lastCartArg()).toBe('');
      expect(screen.getByLabelText('Mã giảm giá')).toHaveValue('');
    });

    it.each([
      ['Voucher has expired', 'Mã giảm giá đã hết hạn'],
      ['Voucher not found', 'Mã giảm giá không tồn tại'],
      ['Voucher is not active', 'Mã giảm giá hiện không được sử dụng'],
      ['Voucher usage limit has been reached', 'Mã giảm giá đã hết lượt sử dụng'],
      [
        'Order amount is below the voucher minimum (300000)',
        'Đơn hàng chưa đạt mức tối thiểu 300.000 ₫ để dùng mã này',
      ],
      [
        'Voucher does not apply to any item in your cart',
        'Mã này không áp dụng cho sản phẩm nào trong giỏ hàng',
      ],
      ['Lý do lạ chưa biết', 'Không áp dụng được mã giảm giá này'],
    ])('BE từ chối "%s" -> hiện bản dịch, không lộ tiếng Anh', async (beMessage, expected) => {
      const user = userEvent.setup();
      mockCart({ cart: cartView() });
      const { rerender } = renderContainer();
      await user.type(screen.getByLabelText('Mã giảm giá'), 'BAD');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));

      mockCart({ cart: cartView(), voucherError: beMessage });
      rerender(withIntl(<CartPageContainer />));

      expect(screen.getByRole('alert')).toHaveTextContent(expected);
      expect(screen.queryByText(beMessage)).not.toBeInTheDocument();
      // giỏ vẫn hiện bình thường, không bị lỗi mã làm hỏng trang
      expect(screen.getByRole('region', { name: 'Shop A' })).toBeInTheDocument();
    });

    it('chưa áp mã nào thì không hiện lỗi dù voucherError có giá trị cũ', () => {
      mockCart({ cart: cartView(), voucherError: 'Voucher has expired' });

      renderContainer();

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('nút thanh toán disabled kèm ghi chú, không bấm được (checkout thuộc Tuần 7)', () => {
    mockCart({ cart: cartView() });

    renderContainer();

    const button = screen.getByRole('button', { name: 'Tiến hành thanh toán' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Tính năng thanh toán sắp ra mắt');
  });
});
