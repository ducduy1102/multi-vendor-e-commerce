import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CheckoutPreviewOrder } from '../types';
import { CheckoutOrderGroup } from './CheckoutOrderGroup';

function order(overrides: Partial<CheckoutPreviewOrder> = {}): CheckoutPreviewOrder {
  return {
    shopId: 'shop-1',
    shopName: 'Shop Áo Xinh',
    shopSlug: 'shop-ao-xinh',
    items: [
      {
        id: 'item-1',
        productVariantId: 'variant-1',
        quantity: 2,
        productId: 'product-1',
        productName: 'Áo thun',
        productSlug: 'ao-thun',
        imageUrl: null,
        attributes: [{ name: 'Size', value: 'M' }],
        unitPrice: '100000',
        lineTotal: '200000',
        stock: 10,
        isAvailable: true,
      },
    ],
    subtotal: '200000',
    shippingFee: '16500',
    discountAmount: '0',
    total: '216500',
    ...overrides,
  };
}

describe('CheckoutOrderGroup', () => {
  it('hiện tên shop, tên sản phẩm, số lượng và thành tiền dòng hàng', () => {
    render(withIntl(<CheckoutOrderGroup order={order()} />));

    expect(screen.getByText('Shop Áo Xinh')).toBeInTheDocument();
    expect(screen.getByText('Áo thun')).toBeInTheDocument();
    expect(screen.getByText('Size: M')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getAllByText(/200\.000/)[0]).toBeInTheDocument();
  });

  it('discountAmount = 0 -> KHÔNG hiện dòng giảm giá', () => {
    render(withIntl(<CheckoutOrderGroup order={order({ discountAmount: '0' })} />));

    expect(screen.queryByText('Giảm giá')).not.toBeInTheDocument();
  });

  it('discountAmount > 0 -> hiện dòng giảm giá', () => {
    render(withIntl(<CheckoutOrderGroup order={order({ discountAmount: '20000' })} />));

    expect(screen.getByText('Giảm giá')).toBeInTheDocument();
    expect(screen.getByText('-20.000 ₫')).toBeInTheDocument();
  });

  it('shippingFee/total null (chưa chọn địa chỉ) -> hiện gạch ngang thay vì tiền', () => {
    render(withIntl(<CheckoutOrderGroup order={order({ shippingFee: null, total: null })} />));

    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(2);
  });
});
