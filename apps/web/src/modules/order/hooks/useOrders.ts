import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as orderService from '../services/order.service';
import type { OrderListQuery } from '../types';
import { orderListQueryKey } from './order-query-keys';

// Danh sách đơn của chính người dùng đăng nhập (route /orders đã bị chặn ở proxy.ts nên chắc
// chắn có phiên). `tab`/`page` do trang truyền xuống từ searchParams; bỏ trống thì BE tự áp default.
export function useOrders(query: Partial<OrderListQuery> = {}) {
  return useQuery({
    queryKey: orderListQueryKey(query),
    queryFn: () => orderService.listOrders(query),
    retry: shouldRetryQuery,
  });
}
