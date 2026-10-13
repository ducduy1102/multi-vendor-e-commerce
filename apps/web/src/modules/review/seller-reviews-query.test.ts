import { describe, expect, it } from 'vitest';

import {
  buildSellerReviewsHref,
  buildSellerReviewsPagination,
  parseSellerReviewsPageQuery,
} from './seller-reviews-query';

describe('parseSellerReviewsPageQuery', () => {
  it('không có param -> tất cả, mọi số sao, trang 1', () => {
    expect(parseSellerReviewsPageQuery({})).toEqual({
      replied: undefined,
      rating: undefined,
      page: 1,
    });
  });

  it.each([
    ['true', 'true'],
    ['false', 'false'],
  ] as const)('?replied=%s -> %s', (raw, expected) => {
    expect(parseSellerReviewsPageQuery({ replied: raw }).replied).toBe(expected);
  });

  it.each(['yes', '1', 'TRUE', 'all', '', 'toString'])(
    '?replied=%j không hợp lệ -> bỏ lọc (không gửi giá trị BE từ chối)',
    (replied) => {
      expect(parseSellerReviewsPageQuery({ replied }).replied).toBeUndefined();
    },
  );

  it.each([
    ['1', 1],
    ['5', 5],
    ['3', 3],
  ])('?rating=%s -> %d', (rating, expected) => {
    expect(parseSellerReviewsPageQuery({ rating }).rating).toBe(expected);
  });

  it.each(['0', '6', '-1', '3.5', 'abc', ''])(
    '?rating=%j ngoài 1-5 hoặc sai dạng -> bỏ lọc số sao',
    (rating) => {
      expect(parseSellerReviewsPageQuery({ rating }).rating).toBeUndefined();
    },
  );

  it.each([
    ['4', 4],
    ['0', 1],
    ['-2', 1],
    ['x', 1],
    ['', 1],
  ])('?page=%j -> %d', (page, expected) => {
    expect(parseSellerReviewsPageQuery({ page }).page).toBe(expected);
  });

  it('từng param sai rơi về mặc định ĐỘC LẬP, không kéo theo param còn lại', () => {
    expect(parseSellerReviewsPageQuery({ replied: 'x', rating: '4', page: '2' })).toEqual({
      replied: undefined,
      rating: 4,
      page: 2,
    });
    expect(parseSellerReviewsPageQuery({ replied: 'false', rating: '9', page: '2' })).toEqual({
      replied: 'false',
      rating: undefined,
      page: 2,
    });
  });

  it('param lặp (mảng) -> lấy giá trị đầu', () => {
    expect(
      parseSellerReviewsPageQuery({ replied: ['true', 'false'], rating: ['2', '5'], page: ['3'] }),
    ).toEqual({ replied: 'true', rating: 2, page: 3 });
  });
});

describe('buildSellerReviewsHref', () => {
  it('mặc định hết -> đường dẫn trần', () => {
    expect(buildSellerReviewsHref()).toBe('/seller/reviews');
    expect(buildSellerReviewsHref({ replied: undefined, rating: undefined, page: 1 })).toBe(
      '/seller/reviews',
    );
  });

  it('có bộ lọc -> có param tương ứng, thứ tự cố định', () => {
    expect(buildSellerReviewsHref({ replied: 'false' })).toBe('/seller/reviews?replied=false');
    expect(buildSellerReviewsHref({ rating: 2 })).toBe('/seller/reviews?rating=2');
    expect(buildSellerReviewsHref({ replied: 'true', rating: 5, page: 3 })).toBe(
      '/seller/reviews?replied=true&rating=5&page=3',
    );
  });

  it('href dựng ra parse ngược lại đúng truy vấn (vòng tròn)', () => {
    const query = { replied: 'false' as const, rating: 3, page: 4 };
    const params = Object.fromEntries(
      new URL(buildSellerReviewsHref(query), 'http://x').searchParams,
    );

    expect(parseSellerReviewsPageQuery(params)).toEqual(query);
  });
});

describe('buildSellerReviewsPagination', () => {
  const base = { replied: 'false' as const, rating: undefined, page: 2 };

  it('tổng trang làm tròn lên, tối thiểu 1 kể cả khi rỗng', () => {
    expect(
      buildSellerReviewsPagination({ query: { ...base, page: 1 }, total: 0, limit: 10 }).totalPages,
    ).toBe(1);
    expect(buildSellerReviewsPagination({ query: base, total: 25, limit: 10 }).totalPages).toBe(3);
  });

  it('prev/next kế bên và GIỮ bộ lọc', () => {
    expect(buildSellerReviewsPagination({ query: base, total: 30, limit: 10 })).toEqual({
      totalPages: 3,
      prevHref: '/seller/reviews?replied=false',
      nextHref: '/seller/reviews?replied=false&page=3',
    });
  });

  it('trang vượt quá trang cuối (trả lời hết đánh giá cuối ở tab "Chưa trả lời") -> "Trước" nhảy về trang cuối thật', () => {
    const pagination = buildSellerReviewsPagination({
      query: { ...base, page: 7 },
      total: 21,
      limit: 10,
    });

    expect(pagination.prevHref).toBe('/seller/reviews?replied=false&page=3');
    expect(pagination.nextHref).toBe('/seller/reviews?replied=false&page=3');
  });
});
