import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import { getShopAppeals } from '../services/appeal.service';
import { shopAppealsQueryKey } from './appeal-query-keys';

// Lịch sử kháng nghị + cờ `canAppeal` của shop. 401/403/404 không thử lại (kết quả chắc chắn), lỗi tạm thời thử lại tối đa 2 lần.
export function useShopAppeals(shopId: string) {
  return useQuery({
    queryKey: shopAppealsQueryKey(shopId),
    queryFn: () => getShopAppeals(shopId),
    retry: shouldRetryQuery,
  });
}
