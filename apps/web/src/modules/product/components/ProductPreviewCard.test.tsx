import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
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

describe('ProductPreviewCard — đánh giá', () => {
  it('reviewCount > 0: hiện sao theo avgRating, số đánh giá "(12)" và nhãn sr-only "12 đánh giá"', () => {
    render(
      withIntl(<ProductPreviewCard product={{ ...product, avgRating: 4.5, reviewCount: 12 }} />),
    );

    expect(screen.getByRole('img', { name: '4,5 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('(12)')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('12 đánh giá')).toHaveClass('sr-only');
  });

  it('reviewCount = 0: KHÔNG có sao (avgRating 0 không được vẽ thành 5 sao viền) nhưng hàng vẫn chiếm chiều cao cố định', () => {
    const { container } = render(withIntl(<ProductPreviewCard product={product} />));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/đánh giá/)).not.toBeInTheDocument();
    // Hàng sao luôn là phần tử cuối của khối thông tin và cao h-4: thẻ có/không có đánh giá cao bằng nhau.
    const row = container.querySelector('a > div:last-child > div:last-child');
    expect(row).toHaveClass('h-4');
    expect(row).toBeEmptyDOMElement();
  });

  it('sao nằm TRONG liên kết của thẻ (bấm vào sao cũng vào trang chi tiết)', () => {
    render(withIntl(<ProductPreviewCard product={{ ...product, avgRating: 3, reviewCount: 2 }} />));

    expect(screen.getByRole('link')).toContainElement(screen.getByRole('img'));
  });

  it('số đánh giá tiếng Anh có số nhiều đúng ("1 review")', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProductPreviewCard product={{ ...product, avgRating: 5, reviewCount: 1 }} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('1 review')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument();
  });
});
