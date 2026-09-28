import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useAddToCart } from '../hooks/useAddToCart';
import { useCartStore } from '../store/cart.store';
import { AddToCartButton } from './AddToCartButton';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('../hooks/useAddToCart', () => ({
  useAddToCart: vi.fn(),
}));

type MutateOptions = { onSuccess?: () => void; onError?: (error: Error) => void };

function mockMutation(behaviour?: (options: MutateOptions) => void, isPending = false) {
  const mutate = vi.fn((_vars: unknown, options: MutateOptions) => behaviour?.(options));
  vi.mocked(useAddToCart).mockReturnValue({
    mutate,
    isPending,
  } as unknown as ReturnType<typeof useAddToCart>);
  return mutate;
}

const ADD_LABEL = 'Thêm vào giỏ hàng';

describe('AddToCartButton', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    mockMutation();
  });

  it('chưa chọn đủ phân loại -> nút disabled kèm gợi ý, không gọi API', async () => {
    const mutate = mockMutation();
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId={null} stock={0} />));

    const button = screen.getByRole('button', { name: ADD_LABEL });
    expect(button).toBeDisabled();
    expect(screen.getByText('Vui lòng chọn đủ phân loại hàng')).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription('Vui lòng chọn đủ phân loại hàng');

    await user.click(button);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('combo đã chọn nhưng hết hàng -> disabled kèm "hết hàng", stepper cũng disabled', () => {
    render(withIntl(<AddToCartButton productVariantId="v1" stock={0} />));

    expect(screen.getByRole('button', { name: ADD_LABEL })).toBeDisabled();
    expect(screen.getByText('Phân loại này đã hết hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
  });

  it('còn hàng -> bật nút, không hiện gợi ý, bấm thì thêm đúng variant và số lượng 1', async () => {
    const mutate = mockMutation();
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    const button = screen.getByRole('button', { name: ADD_LABEL });
    expect(button).toBeEnabled();
    expect(screen.queryByText('Vui lòng chọn đủ phân loại hàng')).not.toBeInTheDocument();

    await user.click(button);

    expect(mutate).toHaveBeenCalledWith(
      { productVariantId: 'v1', quantity: 1 },
      expect.any(Object),
    );
  });

  it('stepper tăng/giảm trong khoảng 1..stock rồi gửi đúng số lượng đã chọn', async () => {
    const mutate = mockMutation();
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={3} />));

    const increase = screen.getByRole('button', { name: 'Tăng số lượng' });
    const decrease = screen.getByRole('button', { name: 'Giảm số lượng' });
    expect(decrease).toBeDisabled();

    await user.click(increase);
    await user.click(increase);
    expect(screen.getByRole('status')).toHaveTextContent('3');
    expect(increase).toBeDisabled();

    await user.click(decrease);
    await user.click(screen.getByRole('button', { name: ADD_LABEL }));

    expect(mutate).toHaveBeenCalledWith(
      { productVariantId: 'v1', quantity: 2 },
      expect.any(Object),
    );
  });

  it('đổi sang combo tồn kho ít hơn -> kẹp số lượng xuống, không vượt kho', async () => {
    const mutate = mockMutation();
    const user = userEvent.setup();
    const { rerender } = render(withIntl(<AddToCartButton productVariantId="v1" stock={10} />));

    const increase = screen.getByRole('button', { name: 'Tăng số lượng' });
    await user.click(increase);
    await user.click(increase);
    await user.click(increase);
    expect(screen.getByRole('status')).toHaveTextContent('4');

    rerender(withIntl(<AddToCartButton productVariantId="v2" stock={2} />));
    expect(screen.getByRole('status')).toHaveTextContent('2');

    await user.click(screen.getByRole('button', { name: ADD_LABEL }));
    expect(mutate).toHaveBeenCalledWith(
      { productVariantId: 'v2', quantity: 2 },
      expect.any(Object),
    );
  });

  it('thêm thành công -> toast thành công và đặt lại số lượng về 1', async () => {
    mockMutation((options) => options.onSuccess?.());
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await user.click(screen.getByRole('button', { name: ADD_LABEL }));

    expect(toastSuccess).toHaveBeenCalledWith('Đã thêm vào giỏ hàng');
    expect(screen.getByRole('status')).toHaveTextContent('1');
  });

  it('409 (vượt tồn kho/ngừng bán) -> toast lỗi đã dịch, không lộ message tiếng Anh của BE', async () => {
    mockMutation((options) =>
      options.onError?.(new ApiError('Quantity exceeds available stock (3)', 409)),
    );
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    await user.click(screen.getByRole('button', { name: ADD_LABEL }));

    expect(toastError).toHaveBeenCalledWith(
      'Không thể thêm: số lượng vượt tồn kho hoặc sản phẩm không còn bán',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('401 -> toast nhắc đăng nhập lại', async () => {
    mockMutation((options) => options.onError?.(new ApiError('Unauthorized', 401)));
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    await user.click(screen.getByRole('button', { name: ADD_LABEL }));

    expect(toastError).toHaveBeenCalledWith('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  });

  it('lỗi khác (mạng/500) -> toast lỗi chung', async () => {
    mockMutation((options) => options.onError?.(new Error('network')));
    const user = userEvent.setup();
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    await user.click(screen.getByRole('button', { name: ADD_LABEL }));

    expect(toastError).toHaveBeenCalledWith('Không thêm được vào giỏ hàng, vui lòng thử lại');
  });

  it('đang gửi -> nút và stepper disabled, chặn bấm trùng', () => {
    mockMutation(undefined, true);
    render(withIntl(<AddToCartButton productVariantId="v1" stock={5} />));

    expect(screen.getByRole('button', { name: ADD_LABEL })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
  });

  // Regression: guest thêm nhiều lần cộng dồn vượt kho (kho 15, đã có 15 mà vẫn
  // thêm được 1 nữa thành 16, giỏ báo "Chỉ còn 15"). Guest không có API kiểm
  // kho lúc thêm nên nút phải tự trừ số đã có trong localStorage.
  describe('giỏ guest đã có sẵn variant này', () => {
    beforeEach(() => {
      act(() => {
        useAuthStore.setState({ user: null, isHydrating: false });
        useCartStore.setState({ items: [], hasHydrated: true });
      });
    });

    afterEach(() => {
      act(() => {
        useAuthStore.setState({ user: null, isHydrating: true });
        useCartStore.setState({ items: [], hasHydrated: false });
      });
    });

    function setGuestCart(quantity: number, variantId = 'v1') {
      act(() => {
        useCartStore.setState({ items: [{ productVariantId: variantId, quantity }] });
      });
    }

    it('đã có đủ số còn lại -> không cho thêm nữa, có gợi ý rõ ràng', async () => {
      setGuestCart(15);
      const mutate = mockMutation();
      const user = userEvent.setup();
      render(withIntl(<AddToCartButton productVariantId="v1" stock={15} />));

      const button = screen.getByRole('button', { name: ADD_LABEL });
      expect(button).toBeDisabled();
      expect(
        screen.getByText('Bạn đã có 15 sản phẩm này trong giỏ, đã đạt tối đa số lượng còn lại'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();

      await user.click(button);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('còn dư ít -> stepper chỉ cho chọn tới số còn lại, và gửi đúng số đó', async () => {
      setGuestCart(12);
      const mutate = mockMutation();
      const user = userEvent.setup();
      render(withIntl(<AddToCartButton productVariantId="v1" stock={15} />));

      const increase = screen.getByRole('button', { name: 'Tăng số lượng' });
      await user.click(increase);
      await user.click(increase);
      await user.click(increase);
      expect(screen.getByRole('status')).toHaveTextContent('3');
      expect(increase).toBeDisabled();

      await user.click(screen.getByRole('button', { name: ADD_LABEL }));
      expect(mutate).toHaveBeenCalledWith(
        { productVariantId: 'v1', quantity: 3 },
        expect.any(Object),
      );
    });

    it('chỉ tính đúng variant đang xem, giỏ có variant khác không ảnh hưởng', () => {
      setGuestCart(15, 'other-variant');
      render(withIntl(<AddToCartButton productVariantId="v1" stock={15} />));

      expect(screen.getByRole('button', { name: ADD_LABEL })).toBeEnabled();
    });

    it('đã đăng nhập -> không tự trừ (BE chặn bằng 409), bỏ qua giỏ guest còn sót', () => {
      act(() => {
        useAuthStore.setState({
          user: {
            id: 'user-1',
            email: 'a@example.com',
            name: 'A',
            role: 'USER',
            emailVerifiedAt: null,
          },
          isHydrating: false,
        });
      });
      setGuestCart(15);
      render(withIntl(<AddToCartButton productVariantId="v1" stock={15} />));

      expect(screen.getByRole('button', { name: ADD_LABEL })).toBeEnabled();
    });
  });
});
