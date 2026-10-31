import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductAppealEntry } from './ProductAppealEntry';

const mocks = vi.hoisted(() => ({
  shop: { current: undefined as { id: string; status: string } | undefined | null },
}));

vi.mock('@/modules/shop', () => ({
  useMyShop: () => ({ data: mocks.shop.current }),
}));
vi.mock('@/modules/appeal', () => ({
  ProductAppealSection: ({ shopId, productId }: { shopId: string; productId: string }) => (
    <div data-testid="appeal-section">{`${shopId}:${productId}`}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('ProductAppealEntry', () => {
  it('đã biết "shop của tôi" ⇒ dựng mục kháng nghị cho ĐÚNG shop và sản phẩm', () => {
    mocks.shop.current = { id: 'shop-1', status: 'APPROVED' };

    render(<ProductAppealEntry productId="product-9" />);

    expect(screen.getByTestId('appeal-section')).toHaveTextContent('shop-1:product-9');
  });

  it.each(['APPROVED', 'SUSPENDED', 'PENDING', 'REJECTED'])(
    'shop %s: trạng thái shop không quyết định mục này (kháng nghị sản phẩm độc lập với trạng thái shop)',
    (status) => {
      mocks.shop.current = { id: 'shop-1', status };

      render(<ProductAppealEntry productId="product-9" />);

      expect(screen.getByTestId('appeal-section')).toBeInTheDocument();
    },
  );

  it.each([undefined, null])('chưa có "shop của tôi" (%s) ⇒ chưa dựng mục', (shop) => {
    mocks.shop.current = shop;

    const { container } = render(<ProductAppealEntry productId="product-9" />);

    expect(screen.queryByTestId('appeal-section')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
