import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ProductVariantSection } from './ProductVariantSection';
import { VariantSelectionProvider } from './VariantSelectionContext';
import type { SelectorAttribute, SelectorVariant } from './VariantSelector.utils';

// AddToCartButton thật cần QueryClient + hook giỏ hàng — đã có test riêng ở
// modules/cart. Ở đây chỉ kiểm ProductVariantSection truyền ĐÚNG variant/tồn
// kho đang chọn xuống nút, nên thay bằng stub phơi props ra data-attribute.
vi.mock('@/modules/cart', () => ({
  AddToCartButton: ({
    productVariantId,
    stock,
  }: {
    productVariantId: string | null;
    stock: number;
  }) => (
    <div
      data-testid="add-to-cart"
      data-variant-id={productVariantId ?? ''}
      data-stock={String(stock)}
    />
  ),
}));

function variant(
  id: string,
  price: string,
  attributeValues: { attributeName: string; value: string }[],
): SelectorVariant {
  return {
    id,
    sku: id,
    price,
    stock: 10,
    isActive: true,
    images: [],
    weightGram: null,
    attributeValues,
  };
}

function attribute(id: string, name: string, values: string[]): SelectorAttribute {
  return {
    id,
    name,
    position: 0,
    values: values.map((value) => ({ id: `${id}-${value}`, value })),
  };
}

describe('ProductVariantSection', () => {
  it('chưa chọn đủ combo -> hiện khoảng minPrice-maxPrice', () => {
    const attributes: SelectorAttribute[] = [attribute('attr-size', 'Size', ['M', 'L'])];
    const variants = [
      variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]),
      variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]),
    ];

    render(
      withIntl(
        <VariantSelectionProvider>
          <ProductVariantSection
            attributes={attributes}
            variants={variants}
            minPrice="100000"
            maxPrice="150000"
          />
        </VariantSelectionProvider>,
      ),
    );

    expect(screen.getByText('100.000 ₫ - 150.000 ₫')).toBeInTheDocument();
  });

  it('chọn đủ combo khớp đúng 1 variant -> đổi sang giá cụ thể của variant đó', async () => {
    const attributes: SelectorAttribute[] = [attribute('attr-size', 'Size', ['M', 'L'])];
    const variants = [
      variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]),
      variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]),
    ];

    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelectionProvider>
          <ProductVariantSection
            attributes={attributes}
            variants={variants}
            minPrice="100000"
            maxPrice="150000"
          />
        </VariantSelectionProvider>,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'L' }));

    expect(screen.getByText('150.000 ₫')).toBeInTheDocument();
    expect(screen.queryByText('100.000 ₫ - 150.000 ₫')).not.toBeInTheDocument();
  });

  it('bỏ chọn (toggle off) -> quay lại khoảng giá', async () => {
    const attributes: SelectorAttribute[] = [attribute('attr-size', 'Size', ['M', 'L'])];
    const variants = [
      variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]),
      variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]),
    ];

    const user = userEvent.setup();
    render(
      withIntl(
        <VariantSelectionProvider>
          <ProductVariantSection
            attributes={attributes}
            variants={variants}
            minPrice="100000"
            maxPrice="150000"
          />
        </VariantSelectionProvider>,
      ),
    );

    const lButton = screen.getByRole('button', { name: 'L' });
    await user.click(lButton);
    expect(screen.getByText('150.000 ₫')).toBeInTheDocument();

    await user.click(lButton);
    expect(screen.getByText('100.000 ₫ - 150.000 ₫')).toBeInTheDocument();
  });

  it('sản phẩm không có attribute (giá cố định) -> hiện đúng giá duy nhất, không phải khoảng', () => {
    const variants = [variant('v-default', '200000', [])];

    render(
      withIntl(
        <VariantSelectionProvider>
          <ProductVariantSection
            attributes={[]}
            variants={variants}
            minPrice="200000"
            maxPrice="200000"
          />
        </VariantSelectionProvider>,
      ),
    );

    expect(screen.getByText('200.000 ₫')).toBeInTheDocument();
  });

  describe('nút thêm vào giỏ hàng', () => {
    const attributes: SelectorAttribute[] = [attribute('attr-size', 'Size', ['M', 'L'])];

    function renderSection(variants: SelectorVariant[]) {
      render(
        withIntl(
          <VariantSelectionProvider>
            <ProductVariantSection
              attributes={attributes}
              variants={variants}
              minPrice="100000"
              maxPrice="150000"
            />
          </VariantSelectionProvider>,
        ),
      );
    }

    it('chưa chọn đủ combo -> truyền variant null, tồn kho 0', () => {
      renderSection([
        variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]),
        variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]),
      ]);

      const button = screen.getByTestId('add-to-cart');
      expect(button).toHaveAttribute('data-variant-id', '');
      expect(button).toHaveAttribute('data-stock', '0');
    });

    it('chọn đủ combo -> truyền đúng id và tồn kho của variant khớp', async () => {
      const user = userEvent.setup();
      renderSection([
        { ...variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]), stock: 4 },
        { ...variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]), stock: 7 },
      ]);

      await user.click(screen.getByRole('button', { name: 'L' }));

      const button = screen.getByTestId('add-to-cart');
      expect(button).toHaveAttribute('data-variant-id', 'v-l');
      expect(button).toHaveAttribute('data-stock', '7');
    });

    it('đổi sang combo khác -> nút nhận tồn kho của combo mới', async () => {
      const user = userEvent.setup();
      renderSection([
        { ...variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]), stock: 4 },
        { ...variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]), stock: 7 },
      ]);

      await user.click(screen.getByRole('button', { name: 'M' }));
      expect(screen.getByTestId('add-to-cart')).toHaveAttribute('data-stock', '4');

      await user.click(screen.getByRole('button', { name: 'L' }));
      expect(screen.getByTestId('add-to-cart')).toHaveAttribute('data-stock', '7');
    });

    it('bỏ chọn combo -> quay lại variant null', async () => {
      const user = userEvent.setup();
      renderSection([
        variant('v-m', '100000', [{ attributeName: 'Size', value: 'M' }]),
        variant('v-l', '150000', [{ attributeName: 'Size', value: 'L' }]),
      ]);

      const lButton = screen.getByRole('button', { name: 'L' });
      await user.click(lButton);
      await user.click(lButton);

      expect(screen.getByTestId('add-to-cart')).toHaveAttribute('data-variant-id', '');
    });

    it('sản phẩm không có attribute -> tự khớp variant duy nhất', () => {
      render(
        withIntl(
          <VariantSelectionProvider>
            <ProductVariantSection
              attributes={[]}
              variants={[{ ...variant('v-default', '200000', []), stock: 3 }]}
              minPrice="200000"
              maxPrice="200000"
            />
          </VariantSelectionProvider>,
        ),
      );

      const button = screen.getByTestId('add-to-cart');
      expect(button).toHaveAttribute('data-variant-id', 'v-default');
      expect(button).toHaveAttribute('data-stock', '3');
    });
  });
});
