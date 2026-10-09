import { describe, expect, it } from 'vitest';

import {
  orderListQueryKey,
  buyerOrdersQueryKey,
  orderListsQueryKey,
  orderQueryKey,
  sellerOrderListQueryKey,
  sellerOrderListsQueryKey,
  sellerOrderQueryKey,
  sellerOrdersQueryKey,
  sellerRefundRequestListQueryKey,
  sellerRefundRequestListsQueryKey,
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

  it('tiền tố buyer bao trùm cả danh sách lẫn chi tiết (để làm mới cả hai cùng lúc)', () => {
    expect(orderListsQueryKey().slice(0, 2)).toEqual(buyerOrdersQueryKey());
    expect(orderQueryKey('o1').slice(0, 2)).toEqual(buyerOrdersQueryKey());
    expect(sellerOrderQueryKey('shop-1', 'o1').slice(0, 2)).not.toEqual(buyerOrdersQueryKey());
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

  it('hàng chờ yêu cầu hủy/trả hàng nằm TRONG nhánh seller của shop (làm mới cả nhánh thì hàng chờ cũng được làm mới)', () => {
    expect(sellerRefundRequestListsQueryKey('shop-1').slice(0, 3)).toEqual(
      sellerOrdersQueryKey('shop-1'),
    );
    expect(sellerRefundRequestListQueryKey('shop-1', { page: 2 }).slice(0, 4)).toEqual(
      sellerRefundRequestListsQueryKey('shop-1'),
    );
    // Nhưng KHÔNG trùng nhánh danh sách đơn: làm mới danh sách đơn không tự kéo hàng chờ (useCancelSellerOrder
    // phải làm mới hàng chờ riêng).
    expect(sellerRefundRequestListsQueryKey('shop-1')).not.toEqual(
      sellerOrderListsQueryKey('shop-1'),
    );
  });

  it('mỗi bộ lọc/trang của hàng chờ là 1 key riêng, mỗi shop là 1 nhánh riêng', () => {
    expect(sellerRefundRequestListQueryKey('shop-1', { status: 'ESCALATED' })).not.toEqual(
      sellerRefundRequestListQueryKey('shop-1', { status: 'PENDING_SELLER' }),
    );
    expect(sellerRefundRequestListQueryKey('shop-1', { page: 1 })).not.toEqual(
      sellerRefundRequestListQueryKey('shop-1', { page: 2 }),
    );
    expect(sellerRefundRequestListsQueryKey('shop-1')).not.toEqual(
      sellerRefundRequestListsQueryKey('shop-2'),
    );
  });
});
