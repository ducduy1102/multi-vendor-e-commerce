import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SellerShopAppealEntry } from './SellerShopAppealEntry';

const mocks = vi.hoisted(() => ({
  shop: { current: undefined as { id: string; status: string } | undefined | null },
}));

vi.mock('@/modules/shop', () => ({
  useMyShop: () => ({ data: mocks.shop.current }),
}));
vi.mock('@/modules/appeal', () => ({
  ShopAppealSection: ({ shopId }: { shopId: string }) => (
    <div data-testid="appeal-section">{shopId}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('SellerShopAppealEntry', () => {
  it('shop đang bị khoá ⇒ dựng mục kháng nghị cho ĐÚNG shop của mình', () => {
    mocks.shop.current = { id: 'shop-1', status: 'SUSPENDED' };

    render(<SellerShopAppealEntry />);

    expect(screen.getByTestId('appeal-section')).toHaveTextContent('shop-1');
  });

  it.each(['APPROVED', 'PENDING', 'REJECTED'])(
    'shop %s ⇒ không có gì để kháng nghị, không dựng mục',
    (status) => {
      mocks.shop.current = { id: 'shop-1', status };

      render(<SellerShopAppealEntry />);

      expect(screen.queryByTestId('appeal-section')).not.toBeInTheDocument();
    },
  );

  it.each([undefined, null])('chưa có "shop của tôi" (%s) ⇒ không dựng mục', (shop) => {
    mocks.shop.current = shop;

    render(<SellerShopAppealEntry />);

    expect(screen.queryByTestId('appeal-section')).not.toBeInTheDocument();
  });
});
