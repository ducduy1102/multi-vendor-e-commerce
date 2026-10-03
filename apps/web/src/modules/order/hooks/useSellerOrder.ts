import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';

export function useSellerOrder(shopId: string, orderId: string) {
  return useQuery({
    queryKey: sellerOrderQueryKey(shopId, orderId),
    queryFn: () => orderService.getSellerOrder(shopId, orderId),
    retry: shouldRetryQuery,
  });
}
