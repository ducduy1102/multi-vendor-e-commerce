import { describe, expect, it } from 'vitest';

import {
  sellerReviewListQueryKey,
  sellerReviewListsQueryKey,
  sellerReviewsQueryKey,
} from './review-query-keys';

describe('review query keys', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để invalidate', () => {
    expect(sellerReviewListQueryKey('shop-1', { page: 2 }).slice(0, 4)).toEqual(
      sellerReviewListsQueryKey('shop-1'),
    );
    expect(sellerReviewListsQueryKey('shop-1').slice(0, 3)).toEqual(
      sellerReviewsQueryKey('shop-1'),
    );
  });

  it('mỗi bộ lọc/trang là 1 key riêng', () => {
    expect(sellerReviewListQueryKey('shop-1', { replied: 'true' })).not.toEqual(
      sellerReviewListQueryKey('shop-1', { replied: 'false' }),
    );
    expect(sellerReviewListQueryKey('shop-1', { page: 1 })).not.toEqual(
      sellerReviewListQueryKey('shop-1', { page: 2 }),
    );
  });

  it('key gắn shopId nên 2 shop không dùng chung cache', () => {
    expect(sellerReviewListsQueryKey('shop-1')).not.toEqual(sellerReviewListsQueryKey('shop-2'));
    expect(sellerReviewListQueryKey('shop-1', {})).not.toEqual(
      sellerReviewListQueryKey('shop-2', {}),
    );
  });
});
