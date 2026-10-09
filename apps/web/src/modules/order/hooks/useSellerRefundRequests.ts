import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as orderService from '../services/order.service';
import type { SellerRefundRequestListQuery } from '../types';
import { sellerRefundRequestListQueryKey } from './order-query-keys';

// shopId do page.tsx (composition root) truyền xuống — module order không tự biết "shop của tôi" (không
// cross-import modules/shop). Hàng chờ xếp theo hạn phản hồi (cũ nhất trước); yêu cầu đã rút không hiện.
export function useSellerRefundRequests(
  shopId: string,
  query: Partial<SellerRefundRequestListQuery> = {},
) {
  return useQuery({
    queryKey: sellerRefundRequestListQueryKey(shopId, query),
    queryFn: () => orderService.listSellerRefundRequests(shopId, query),
    retry: shouldRetryQuery,
  });
}
