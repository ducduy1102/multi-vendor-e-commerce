import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import type { ReviewSummary as ReviewSummaryData } from '../types';
import { ReviewSummary } from './ReviewSummary';

const SUMMARY: ReviewSummaryData = {
  avgRating: 4.25,
  reviewCount: 12,
  distribution: { '1': 0, '2': 1, '3': 1, '4': 3, '5': 7 },
};

const buildHref = (rating: number | undefined) =>
  rating === undefined
    ? '/products/ao-thun#reviews'
    : `/products/ao-thun?reviewRating=${rating}#reviews`;

function renderSummary(overrides: Partial<Parameters<typeof ReviewSummary>[0]> = {}) {
  return render(
    withIntl(
      <ReviewSummary
        summary={SUMMARY}
        activeRating={undefined}
        buildRatingHref={buildHref}
        {...overrides}
      />,
    ),
  );
}

describe('ReviewSummary', () => {
  it('hiện điểm trung bình 1 chữ số thập phân theo locale ("4,3"), sao md và số đánh giá', () => {
    renderSummary();

    expect(screen.getByText('4,3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4,3 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('12 đánh giá')).toBeInTheDocument();
  });

  it('điểm tròn vẫn có phần thập phân ("5,0") để cột điểm không nhảy độ rộng', () => {
    renderSummary({ summary: { ...SUMMARY, avgRating: 5 } });

    expect(screen.getByText('5,0')).toBeInTheDocument();
  });

  it('có 5 hàng phân bố từ 5 sao xuống 1 sao, mỗi hàng là liên kết lọc kèm số đánh giá', () => {
    renderSummary();

    const nav = screen.getByRole('navigation', { name: 'Lọc đánh giá theo số sao' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      '5 sao7',
      '4 sao3',
      '3 sao1',
      '2 sao1',
      '1 sao0',
    ]);
    expect(links[0]).toHaveAttribute('href', '/products/ao-thun?reviewRating=5#reviews');
    expect(links[4]).toHaveAttribute('href', '/products/ao-thun?reviewRating=1#reviews');
  });

  it('chiều rộng thanh = tỷ lệ số đánh giá của mức đó trên tổng (7/12, 3/12, 0) và thanh chỉ trang trí', () => {
    const { container } = renderSummary();

    const fills = [...container.querySelectorAll<HTMLElement>('nav [aria-hidden="true"] > span')];
    const widths = fills.map((node) => Number.parseFloat(node.style.width));
    expect(widths).toHaveLength(5);
    expect(widths[0]).toBeCloseTo((7 / 12) * 100, 5);
    expect(widths[1]).toBeCloseTo((3 / 12) * 100, 5);
    expect(widths[4]).toBe(0);
    for (const fill of fills) expect(fill.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('chưa lọc: không hàng nào active; đang lọc 4 sao: hàng đó aria-current và bấm lại thì BỎ lọc', () => {
    const { rerender } = renderSummary();
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);

    rerender(
      withIntl(<ReviewSummary summary={SUMMARY} activeRating={4} buildRatingHref={buildHref} />),
    );

    const active = screen.getByRole('link', { name: /4 sao/ });
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveAttribute('href', '/products/ao-thun#reviews');
    // Các hàng khác vẫn lọc sang mức của chúng.
    expect(screen.getByRole('link', { name: /5 sao/ })).toHaveAttribute(
      'href',
      '/products/ao-thun?reviewRating=5#reviews',
    );
    expect(screen.getByRole('link', { name: /5 sao/ })).not.toHaveAttribute('aria-current');
  });

  it('tổng 0 đánh giá không chia cho 0 (thanh 0%)', () => {
    const { container } = renderSummary({
      summary: {
        avgRating: 0,
        reviewCount: 0,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      },
    });

    const fills = [...container.querySelectorAll<HTMLElement>('nav [aria-hidden="true"] > span')];
    expect(fills.map((node) => node.style.width)).toEqual(['0%', '0%', '0%', '0%', '0%']);
  });

  it('dùng lưới khai cột tường minh (grid-cols-1 + minmax(0,1fr)) — chuỗi dài không đẩy trang rộng ra', () => {
    const { container } = renderSummary();

    const grid = container.firstElementChild;
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid?.className).toContain('minmax(0,1fr)');
  });
});
