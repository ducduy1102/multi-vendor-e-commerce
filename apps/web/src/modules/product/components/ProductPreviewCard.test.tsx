import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ProductPreviewCard } from './ProductPreviewCard';
import type { ProductCard } from '../types';

const product: ProductCard = {
  id: 'product-1',
  categoryId: 'cat-1',
  name: 'Áo thun nam',
  slug: 'ao-thun-nam',
  minPrice: '100000',
  maxPrice: '150000',
  imageUrl: null,
  avgRating: 0,
  reviewCount: 0,
};

describe('ProductPreviewCard', () => {
  it('mặc định (isAvailable=true) render dạng Link, bấm được vào trang chi tiết', () => {
    render(withIntl(<ProductPreviewCard product={product} />));

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/products/ao-thun-nam');
    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
  });

  it('không hiện badge khi isAvailable=true', () => {
    render(withIntl(<ProductPreviewCard product={product} />));

    expect(screen.queryByText('Ngừng bán')).not.toBeInTheDocument();
  });

  it('isAvailable=false: KHÔNG render Link (không bấm vào trang chi tiết được), hiện đúng badge', () => {
    render(
      withIntl(
        <ProductPreviewCard product={product} isAvailable={false} unavailableLabel="Ngừng bán" />,
      ),
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Ngừng bán')).toBeInTheDocument();
    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
  });

  it('isAvailable=false nhưng thiếu unavailableLabel -> vẫn không render Link, chỉ là không hiện badge', () => {
    render(withIntl(<ProductPreviewCard product={product} isAvailable={false} />));

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
