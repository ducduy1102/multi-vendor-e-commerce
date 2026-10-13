import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
import { withIntl } from '@/shared/lib/test-i18n';
import { ProductRatingLink } from './ProductRatingLink';

describe('ProductRatingLink', () => {
  it('có đánh giá: là liên kết nhảy tới khối đánh giá, hiện sao theo điểm và số đánh giá', () => {
    render(withIntl(<ProductRatingLink avgRating={4.33} reviewCount={12} />));

    const link = screen.getByRole('link', { name: /12 đánh giá/ });
    expect(link).toHaveAttribute('href', '#reviews');
    expect(screen.getByRole('img', { name: '4,3 trên 5 sao' })).toBeInTheDocument();
    expect(link).toContainElement(screen.getByRole('img'));
  });

  it('số điểm hiển thị aria-hidden (nhãn của sao đã đọc ra điểm, không đọc hai lần)', () => {
    render(withIntl(<ProductRatingLink avgRating={4.33} reviewCount={12} />));

    expect(screen.getByText('4,3', { selector: 'span' })).toHaveAttribute('aria-hidden', 'true');
  });

  it('chưa có đánh giá: hiện "Chưa có đánh giá", KHÔNG có liên kết hay sao', () => {
    render(withIntl(<ProductRatingLink avgRating={0} reviewCount={0} />));

    expect(screen.getByText('Chưa có đánh giá')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('dòng luôn cao 20px (h-5) dù có hay không có đánh giá — bố cục không nhảy, skeleton khớp', () => {
    const { container, rerender } = render(
      withIntl(<ProductRatingLink avgRating={5} reviewCount={3} />),
    );
    expect(container.firstElementChild).toHaveClass('h-5');

    rerender(withIntl(<ProductRatingLink avgRating={0} reviewCount={0} />));
    expect(container.firstElementChild).toHaveClass('h-5');
  });

  it('tiếng Anh: "1 review" / "No reviews yet" và nhãn sao đúng', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProductRatingLink avgRating={5} reviewCount={1} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: /1 review/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProductRatingLink avgRating={0} reviewCount={0} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
  });
});
