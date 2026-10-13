import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerReviewsPageQuery } from '../seller-reviews-query';
import { SellerReviewFilters } from './SellerReviewFilters';

const ALL: SellerReviewsPageQuery = { replied: undefined, rating: undefined, page: 1 };

function setup(query: Partial<SellerReviewsPageQuery> = {}) {
  return render(withIntl(<SellerReviewFilters query={{ ...ALL, ...query }} />));
}

const repliedNav = () =>
  screen.getByRole('navigation', { name: 'Lọc đánh giá theo trạng thái trả lời' });
const ratingNav = () => screen.getByRole('navigation', { name: 'Lọc đánh giá theo số sao' });

describe('SellerReviewFilters — tab chưa/đã trả lời', () => {
  it('3 tab theo thứ tự Tất cả / Chưa trả lời / Đã trả lời, link tới đúng URL', () => {
    setup();

    const links = within(repliedNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Tất cả', 'Chưa trả lời', 'Đã trả lời']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/seller/reviews',
      '/seller/reviews?replied=false',
      '/seller/reviews?replied=true',
    ]);
  });

  it.each([
    [undefined, 'Tất cả'],
    ['false', 'Chưa trả lời'],
    ['true', 'Đã trả lời'],
  ] as const)('replied=%s -> chỉ tab "%s" là trang hiện tại', (replied, label) => {
    setup({ replied });

    const current = within(repliedNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it('đổi tab GIỮ bộ lọc số sao đang chọn và về trang 1', () => {
    setup({ rating: 3, page: 4 });

    expect(within(repliedNav()).getByRole('link', { name: 'Chưa trả lời' })).toHaveAttribute(
      'href',
      '/seller/reviews?replied=false&rating=3',
    );
  });
});

describe('SellerReviewFilters — lọc theo số sao', () => {
  it('"Mọi số sao" rồi 5 → 1 sao, link tới đúng URL', () => {
    setup();

    const links = within(ratingNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Mọi số sao',
      '5 sao',
      '4 sao',
      '3 sao',
      '2 sao',
      '1 sao',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/seller/reviews',
      '/seller/reviews?rating=5',
      '/seller/reviews?rating=4',
      '/seller/reviews?rating=3',
      '/seller/reviews?rating=2',
      '/seller/reviews?rating=1',
    ]);
  });

  it('số sao đang lọc được đánh dấu aria-current; không lọc thì là "Mọi số sao"', () => {
    const { unmount } = setup({ rating: 2 });
    expect(within(ratingNav()).getByRole('link', { name: '2 sao' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(ratingNav()).getByRole('link', { name: 'Mọi số sao' })).not.toHaveAttribute(
      'aria-current',
    );
    unmount();

    setup();
    expect(within(ratingNav()).getByRole('link', { name: 'Mọi số sao' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('đổi số sao GIỮ tab chưa/đã trả lời đang chọn và về trang 1', () => {
    setup({ replied: 'false', rating: 5, page: 3 });

    expect(within(ratingNav()).getByRole('link', { name: '4 sao' })).toHaveAttribute(
      'href',
      '/seller/reviews?replied=false&rating=4',
    );
    expect(within(ratingNav()).getByRole('link', { name: 'Mọi số sao' })).toHaveAttribute(
      'href',
      '/seller/reviews?replied=false',
    );
  });

  it('hàng số sao tự xuống dòng ở màn hẹp (flex-wrap) thay vì tràn ngang', () => {
    setup();

    expect(within(ratingNav()).getByRole('list')).toHaveClass('flex-wrap');
  });

  it('hàng tab chưa/đã trả lời tự cuộn ngang trong khung của nó, không làm cả trang tràn', () => {
    setup();

    expect(repliedNav()).toHaveClass('overflow-x-auto');
  });
});
