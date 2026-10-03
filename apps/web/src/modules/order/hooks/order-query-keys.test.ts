import { describe, expect, it } from 'vitest';

import {
  orderListQueryKey,
  orderListsQueryKey,
  orderQueryKey,
  sellerOrderListQueryKey,
  sellerOrderListsQueryKey,
  sellerOrderQueryKey,
} from './order-query-keys';

describe('order query keys', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để invalidate (buyer và seller)', () => {
    expect(orderListQueryKey({ tab: 'pending', page: 2 }).slice(0, 3)).toEqual(
      orderListsQueryKey(),
    );
    expect(sellerOrderListQueryKey('shop-1', { page: 1 }).slice(0, 4)).toEqual(
      sellerOrderListsQueryKey('shop-1'),
    );
  });

  it('mỗi tab/trang là 1 key riêng, mỗi đơn là 1 key riêng', () => {
    expect(orderListQueryKey({ tab: 'pending' })).not.toEqual(
      orderListQueryKey({ tab: 'shipping' }),
    );
    expect(orderListQueryKey({ page: 1 })).not.toEqual(orderListQueryKey({ page: 2 }));
    expect(orderQueryKey('o1')).not.toEqual(orderQueryKey('o2'));
  });

  it('key seller gắn shopId nên 2 shop không dùng chung cache; buyer và seller không trùng nhánh', () => {
    expect(sellerOrderQueryKey('shop-1', 'o1')).not.toEqual(sellerOrderQueryKey('shop-2', 'o1'));
    expect(sellerOrderListsQueryKey('shop-1')).not.toEqual(sellerOrderListsQueryKey('shop-2'));
    expect(orderQueryKey('o1')).not.toEqual(sellerOrderQueryKey('shop-1', 'o1'));
  });
});
