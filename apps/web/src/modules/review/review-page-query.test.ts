import { describe, expect, it } from 'vitest';

import { buildReviewHref, parseReviewPageQuery } from './review-page-query';

describe('parseReviewPageQuery', () => {
  it('không có param -> tất cả sao, trang 1', () => {
    expect(parseReviewPageQuery({})).toEqual({ rating: undefined, page: 1 });
  });

  it('đọc reviewRating và reviewPage (chuỗi từ URL được coerce sang số)', () => {
    expect(parseReviewPageQuery({ reviewRating: '4', reviewPage: '3' })).toEqual({
      rating: 4,
      page: 3,
    });
  });

  it('bỏ qua param KHÁC tiền tố review (rating/page/sort của trang khác không lọt vào)', () => {
    expect(parseReviewPageQuery({ rating: '2', page: '9', sort: 'rating' })).toEqual({
      rating: undefined,
      page: 1,
    });
  });

  it.each(['0', '6', '-1', '3.5', 'abc', ''])(
    'reviewRating "%s" sai dạng/ngoài 1-5 -> rơi về tất cả sao, không ném lỗi',
    (reviewRating) => {
      expect(parseReviewPageQuery({ reviewRating }).rating).toBeUndefined();
    },
  );

  it.each(['0', '-2', '1.5', 'abc', ''])(
    'reviewPage "%s" sai dạng -> rơi về trang 1, không ném lỗi',
    (reviewPage) => {
      expect(parseReviewPageQuery({ reviewPage }).page).toBe(1);
    },
  );

  it('từng param rơi về mặc định ĐỘC LẬP (rating sai không làm mất trang đang xem và ngược lại)', () => {
    expect(parseReviewPageQuery({ reviewRating: 'x', reviewPage: '4' })).toEqual({
      rating: undefined,
      page: 4,
    });
    expect(parseReviewPageQuery({ reviewRating: '5', reviewPage: 'x' })).toEqual({
      rating: 5,
      page: 1,
    });
  });

  it('param lặp (?reviewRating=4&reviewRating=5) lấy giá trị đầu', () => {
    expect(parseReviewPageQuery({ reviewRating: ['4', '5'], reviewPage: ['2', '7'] })).toEqual({
      rating: 4,
      page: 2,
    });
  });
});

describe('buildReviewHref', () => {
  it('không bộ lọc, trang 1 -> chỉ có đường dẫn trang sản phẩm kèm neo #reviews', () => {
    expect(buildReviewHref('ao-thun', {})).toBe('/products/ao-thun#reviews');
    expect(buildReviewHref('ao-thun', { rating: undefined, page: 1 })).toBe(
      '/products/ao-thun#reviews',
    );
  });

  it('có lọc sao và/hoặc trang > 1 -> đưa lên query, neo #reviews đứng cuối', () => {
    expect(buildReviewHref('ao-thun', { rating: 4 })).toBe(
      '/products/ao-thun?reviewRating=4#reviews',
    );
    expect(buildReviewHref('ao-thun', { page: 3 })).toBe('/products/ao-thun?reviewPage=3#reviews');
    expect(buildReviewHref('ao-thun', { rating: 5, page: 2 })).toBe(
      '/products/ao-thun?reviewRating=5&reviewPage=2#reviews',
    );
  });

  it('mã hoá slug lạ trên URL', () => {
    expect(buildReviewHref('a b/c', {})).toBe('/products/a%20b%2Fc#reviews');
  });

  it('kết quả của build đọc lại bằng parse ra đúng bộ lọc ban đầu (khứ hồi)', () => {
    const href = buildReviewHref('ao-thun', { rating: 3, page: 4 });
    const search = new URLSearchParams(href.slice(href.indexOf('?') + 1, href.indexOf('#')));

    expect(
      parseReviewPageQuery({
        reviewRating: search.get('reviewRating') ?? undefined,
        reviewPage: search.get('reviewPage') ?? undefined,
      }),
    ).toEqual({ rating: 3, page: 4 });
  });
});
