import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { withIntl } from '@/shared/lib/test-i18n';

import { StarRating } from './StarRating';

// Chiều rộng (%) của lớp sao đặc phủ lên từng ngôi sao, theo thứ tự trái → phải; ngôi sao không có lớp phủ
// (0%) không xuất hiện trong kết quả.
function fillWidths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="star-fill"]')].map(
    (node) => node.style.width,
  );
}

describe('StarRating', () => {
  it('giá trị lẻ: nhãn dịch kiểu "4,5 trên 5 sao" và sao thứ 5 chỉ phủ 50%', () => {
    const { container } = render(withIntl(<StarRating value={4.5} />));

    expect(screen.getByRole('img', { name: '4,5 trên 5 sao' })).toBeInTheDocument();
    expect(fillWidths(container)).toEqual(['100%', '100%', '100%', '100%', '50%']);
  });

  it('phủ theo đúng phần lẻ, không làm tròn lên nửa sao (3,25 ⇒ sao thứ 4 phủ 25%)', () => {
    const { container } = render(withIntl(<StarRating value={3.25} />));

    expect(fillWidths(container)).toEqual(['100%', '100%', '100%', '25%']);
    // Nhãn làm tròn 1 chữ số thập phân: 3,25 ⇒ "3,3".
    expect(screen.getByRole('img', { name: '3,3 trên 5 sao' })).toBeInTheDocument();
  });

  it('0 sao: vẫn vẽ đủ 5 sao viền, không có lớp phủ nào, nhãn "0 trên 5 sao"', () => {
    const { container } = render(withIntl(<StarRating value={0} />));

    expect(screen.getByRole('img', { name: '0 trên 5 sao' })).toBeInTheDocument();
    expect(fillWidths(container)).toEqual([]);
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });

  it('5 sao: cả 5 sao phủ 100%, nhãn không có phần thập phân thừa', () => {
    const { container } = render(withIntl(<StarRating value={5} />));

    expect(screen.getByRole('img', { name: '5 trên 5 sao' })).toBeInTheDocument();
    expect(fillWidths(container)).toEqual(['100%', '100%', '100%', '100%', '100%']);
  });

  it.each([
    [7, '5 trên 5 sao', 5],
    [-1, '0 trên 5 sao', 0],
    [Number.NaN, '0 trên 5 sao', 0],
    [Number.POSITIVE_INFINITY, '0 trên 5 sao', 0],
  ])('giá trị ngoài khoảng/không hợp lệ %s bị kẹp về 0-5', (value, name, filled) => {
    const { container } = render(withIntl(<StarRating value={value} />));

    expect(screen.getByRole('img', { name })).toBeInTheDocument();
    expect(fillWidths(container)).toHaveLength(filled);
  });

  it('cả hàng là MỘT ảnh có nhãn, từng ngôi sao aria-hidden (trình đọc màn hình không đọc 5 lần)', () => {
    const { container } = render(withIntl(<StarRating value={4} />));

    expect(screen.getAllByRole('img')).toHaveLength(1);
    const stars = container.querySelectorAll('[role="img"] > span');
    expect(stars).toHaveLength(5);
    for (const star of stars) expect(star).toHaveAttribute('aria-hidden', 'true');
  });

  it('kích thước sm (mặc định) và md khác nhau, truyền className ra ngoài cùng', () => {
    const { container, rerender } = render(withIntl(<StarRating value={3} className="shrink-0" />));
    const root = screen.getByRole('img');

    expect(root).toHaveClass('shrink-0');
    expect(container.querySelector('svg')).toHaveClass('size-full');
    expect(container.querySelector('[role="img"] > span')).toHaveClass('size-3.5');

    rerender(withIntl(<StarRating value={3} size="md" />));
    expect(container.querySelector('[role="img"] > span')).toHaveClass('size-5');
  });

  it('chỉ dùng màu ngữ nghĩa: sao đặc text-primary, sao viền text-muted-foreground (không màu thô/accent)', () => {
    const { container } = render(withIntl(<StarRating value={2.5} />));

    const outline = container.querySelector('[role="img"] > span > svg');
    const filled = container.querySelector('[data-slot="star-fill"] svg');
    expect(outline).toHaveClass('text-muted-foreground');
    expect(filled).toHaveClass('text-primary', 'fill-current');
    expect(container.innerHTML).not.toMatch(/accent|amber|yellow|orange|#[0-9a-f]{3,6}/i);
  });

  it('tiếng Anh: số theo locale ("4.5 out of 5 stars")', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StarRating value={4.5} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('img', { name: '4.5 out of 5 stars' })).toBeInTheDocument();
  });
});
