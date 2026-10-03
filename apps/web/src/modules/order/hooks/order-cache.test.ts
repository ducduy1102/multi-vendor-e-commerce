import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { OrderDetail, SellerOrderDetail } from '../types';
import { syncBuyerOrder, syncSellerOrder } from './order-cache';
import {
  orderListQueryKey,
  orderQueryKey,
  sellerOrderListQueryKey,
  sellerOrderQueryKey,
} from './order-query-keys';

const asBuyer = (id: string, status: string) => ({ id, status }) as unknown as OrderDetail;
const asSeller = (id: string, status: string) => ({ id, status }) as unknown as SellerOrderDetail;

function isInvalidated(queryClient: QueryClient, key: readonly unknown[]) {
  return queryClient.getQueryState(key)?.isInvalidated === true;
}

describe('syncBuyerOrder', () => {
  it('ghi chi tiết mới vào cache của đúng đơn và làm mới MỌI danh sách (mọi tab/trang)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(orderQueryKey('o1'), asBuyer('o1', 'PENDING'));
    queryClient.setQueryData(orderQueryKey('o2'), asBuyer('o2', 'PENDING'));
    queryClient.setQueryData(orderListQueryKey({ tab: 'pending', page: 1 }), { items: [] });
    queryClient.setQueryData(orderListQueryKey({ tab: 'cancelled', page: 2 }), { items: [] });

    syncBuyerOrder(queryClient, asBuyer('o1', 'CANCELLED'));

    expect(queryClient.getQueryData(orderQueryKey('o1'))).toEqual({
      id: 'o1',
      status: 'CANCELLED',
    });
    expect(queryClient.getQueryData(orderQueryKey('o2'))).toEqual({ id: 'o2', status: 'PENDING' });
    expect(isInvalidated(queryClient, orderListQueryKey({ tab: 'pending', page: 1 }))).toBe(true);
    expect(isInvalidated(queryClient, orderListQueryKey({ tab: 'cancelled', page: 2 }))).toBe(true);
  });

  it('không đụng cache phía seller', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sellerOrderListQueryKey('shop-1', { tab: 'pending' }), { items: [] });
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'o1'), asSeller('o1', 'PENDING'));

    syncBuyerOrder(queryClient, asBuyer('o1', 'CANCELLED'));

    expect(isInvalidated(queryClient, sellerOrderListQueryKey('shop-1', { tab: 'pending' }))).toBe(
      false,
    );
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'o1'))).toEqual({
      id: 'o1',
      status: 'PENDING',
    });
  });
});

describe('syncSellerOrder', () => {
  it('ghi chi tiết mới vào cache của đúng đơn trong đúng shop và chỉ làm mới danh sách của shop đó', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'o1'), asSeller('o1', 'PENDING'));
    queryClient.setQueryData(sellerOrderQueryKey('shop-2', 'o1'), asSeller('o1', 'PENDING'));
    queryClient.setQueryData(sellerOrderListQueryKey('shop-1', { tab: 'pending' }), { items: [] });
    queryClient.setQueryData(sellerOrderListQueryKey('shop-2', { tab: 'pending' }), { items: [] });

    syncSellerOrder(queryClient, 'shop-1', asSeller('o1', 'CONFIRMED'));

    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'o1'))).toEqual({
      id: 'o1',
      status: 'CONFIRMED',
    });
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-2', 'o1'))).toEqual({
      id: 'o1',
      status: 'PENDING',
    });
    expect(isInvalidated(queryClient, sellerOrderListQueryKey('shop-1', { tab: 'pending' }))).toBe(
      true,
    );
    expect(isInvalidated(queryClient, sellerOrderListQueryKey('shop-2', { tab: 'pending' }))).toBe(
      false,
    );
  });

  it('không đụng cache phía buyer', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(orderListQueryKey({ tab: 'pending' }), { items: [] });

    syncSellerOrder(queryClient, 'shop-1', asSeller('o1', 'CONFIRMED'));

    expect(isInvalidated(queryClient, orderListQueryKey({ tab: 'pending' }))).toBe(false);
  });
});
