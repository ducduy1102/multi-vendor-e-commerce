import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as reviewService from '../services/review.service';
import type { SellerReviewListQuery } from '../types';
import { sellerReviewListQueryKey } from './review-query-keys';

// shopId do page.tsx (composition root) truyền xuống — module review không tự biết "shop của tôi" (không
// cross-import modules/shop). 401/403/404 không thử lại (kết quả chắc chắn); component phải xử lý riêng
// isPending/isError (rules/frontend.md mục 3).
export function useSellerReviews(shopId: string, query: Partial<SellerReviewListQuery> = {}) {
  return useQuery({
    queryKey: sellerReviewListQueryKey(shopId, query),
    queryFn: () => reviewService.listShopReviews(shopId, query),
    retry: shouldRetryQuery,
  });
}
