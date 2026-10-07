import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as orderService from '../services/order.service';
import { orderQueryKey } from './order-query-keys';

// 404 (đơn không tồn tại HOẶC của người khác — BE trả cùng 1 body) là kết quả chắc chắn nên không
// thử lại; component phải xử lý riêng isPending/isError (rules/frontend.md mục 3).
export function useOrder(orderId: string) {
  return useQuery({
    queryKey: orderQueryKey(orderId),
    queryFn: () => orderService.getOrder(orderId),
    retry: shouldRetryQuery,
  });
}
