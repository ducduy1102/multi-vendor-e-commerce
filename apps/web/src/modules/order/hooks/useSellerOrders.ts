import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as orderService from '../services/order.service';
import type { SellerOrderListQuery } from '../types';
import { sellerOrderListQueryKey } from './order-query-keys';

// shopId do page.tsx (composition root) truyền xuống — module order không tự biết "shop của tôi"
// (không cross-import modules/shop). Chỉ đơn Seller được thấy (BE lọc, không có AWAITING_PAYMENT).
export function useSellerOrders(shopId: string, query: Partial<SellerOrderListQuery> = {}) {
  return useQuery({
    queryKey: sellerOrderListQueryKey(shopId, query),
    queryFn: () => orderService.listSellerOrders(shopId, query),
    retry: shouldRetryQuery,
  });
}
