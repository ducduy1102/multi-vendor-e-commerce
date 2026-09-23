import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ProductVariantSection } from './ProductVariantSection';
import { VariantSelectionProvider } from './VariantSelectionContext';
import type { SelectorAttribute, SelectorVariant } from './VariantSelector.utils';

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
});
