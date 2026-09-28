import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CartLine } from '../types';
import { CartItemRow } from './CartItemRow';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'item-1',
    productVariantId: 'v1',
    quantity: 2,
    productId: 'p1',
    productName: 'Áo thun nam',
    productSlug: 'ao-thun-nam',
    imageUrl: null,
    attributes: [
      { name: 'Màu', value: 'Đỏ' },
      { name: 'Size', value: 'M' },
    ],
    unitPrice: '100000',
    lineTotal: '200000',
    stock: 10,
    isAvailable: true,
    ...overrides,
  };
}

function renderRow(cartLine: CartLine, isBusy = false) {
  const onQuantityChange = vi.fn();
  const onRemove = vi.fn();
  render(
    withIntl(
      <ul>
        <CartItemRow
          line={cartLine}
          onQuantityChange={onQuantityChange}
          onRemove={onRemove}
          isBusy={isBusy}
        />
      </ul>,
    ),
  );
  return { onQuantityChange, onRemove };
}

describe('CartItemRow', () => {
  it('còn bán: tên (link), thuộc tính nối bằng dấu chấm giữa, giá đơn vị và thành tiền', () => {
    renderRow(line());

    expect(screen.getByRole('link', { name: 'Áo thun nam' })).toHaveAttribute(
      'href',
      '/products/ao-thun-nam',
    );
    expect(screen.getByText('Màu: Đỏ · Size: M')).toBeInTheDocument();
    expect(screen.getByText('100.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('200.000 ₫')).toBeInTheDocument();
    expect(screen.queryByText('Ngừng bán')).not.toBeInTheDocument();
  });

  it('không có thuộc tính -> không render dòng thuộc tính trống', () => {
    renderRow(line({ attributes: [] }));

    expect(screen.queryByText(/:/)).not.toBeInTheDocument();
  });

  it('có ảnh -> render ảnh trang trí (alt rỗng, tên đã nằm ở link bên cạnh)', () => {
    const { container } = render(
      withIntl(
        <ul>
          <CartItemRow
            line={line({ imageUrl: 'https://example.com/a.jpg' })}
            onQuantityChange={vi.fn()}
            onRemove={vi.fn()}
            isBusy={false}
          />
        </ul>,
      ),
    );

    const image = container.querySelector('img');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('alt', '');
  });

  it('không có ảnh -> hiện icon thay thế, không có thẻ img', () => {
    const { container } = render(
      withIntl(
        <ul>
          <CartItemRow
            line={line({ imageUrl: null })}
            onQuantityChange={vi.fn()}
            onRemove={vi.fn()}
            isBusy={false}
          />
        </ul>,
      ),
    );

    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('bấm + truyền nguyên dòng và số lượng mới lên cha', async () => {
    const user = userEvent.setup();
    const cartLine = line({ quantity: 2, stock: 5 });
    const { onQuantityChange } = renderRow(cartLine);

    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));

    expect(onQuantityChange).toHaveBeenCalledWith(cartLine, 3);
  });

  it('bấm nút xoá truyền nguyên dòng lên cha; nhãn nêu tên sản phẩm', async () => {
    const user = userEvent.setup();
    const cartLine = line();
    const { onRemove } = renderRow(cartLine);

    await user.click(screen.getByRole('button', { name: 'Xoá Áo thun nam khỏi giỏ hàng' }));

    expect(onRemove).toHaveBeenCalledWith(cartLine);
  });

  it('isBusy -> khoá stepper và nút xoá', async () => {
    const user = userEvent.setup();
    const { onQuantityChange, onRemove } = renderRow(line(), true);

    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await user.click(screen.getByRole('button', { name: 'Xoá Áo thun nam khỏi giỏ hàng' }));

    expect(onQuantityChange).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  describe('không khả dụng', () => {
    it('badge + tên mờ, KHÔNG có stepper/thành tiền, nhưng vẫn xoá được', async () => {
      const user = userEvent.setup();
      const { onRemove } = renderRow(line({ isAvailable: false }));

      expect(screen.getByText('Ngừng bán')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Số lượng' })).not.toBeInTheDocument();
      expect(screen.queryByText('200.000 ₫')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Xoá Áo thun nam khỏi giỏ hàng' }));
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('không cảnh báo tồn kho dù số lượng lớn hơn stock (dòng đã ngừng bán)', () => {
      renderRow(line({ isAvailable: false, quantity: 9, stock: 2 }));

      expect(screen.queryByText(/Chỉ còn/)).not.toBeInTheDocument();
      expect(screen.queryByText('Phân loại này đã hết hàng')).not.toBeInTheDocument();
    });
  });

  describe('cảnh báo tồn kho', () => {
    it('quantity > stock (còn hàng) -> "Chỉ còn N", khoá tăng, vẫn giảm được', () => {
      renderRow(line({ quantity: 16, stock: 15 }));

      expect(screen.getByText('Chỉ còn 15 sản phẩm')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toBeEnabled();
    });

    it('quantity đúng bằng stock -> không cảnh báo', () => {
      renderRow(line({ quantity: 5, stock: 5 }));

      expect(screen.queryByText(/Chỉ còn/)).not.toBeInTheDocument();
    });

    it('stock 0 -> "hết hàng" (không phải "Chỉ còn 0"), khoá cả 2 nút', () => {
      renderRow(line({ quantity: 1, stock: 0 }));

      const row = screen.getByRole('listitem');
      expect(within(row).getByText('Phân loại này đã hết hàng')).toBeInTheDocument();
      expect(within(row).queryByText(/Chỉ còn/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toBeDisabled();
    });
  });
});
