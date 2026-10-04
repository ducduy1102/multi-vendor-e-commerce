import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminShopListQuery } from '../types';
import { adminShopListQueryKey } from './admin-query-keys';

// Danh sách shop theo trạng thái cho Admin (mặc định hàng chờ duyệt). 401/403 không thử lại (kết
// quả chắc chắn), lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminShops(query: Partial<AdminShopListQuery> = {}) {
  return useQuery({
    queryKey: adminShopListQueryKey(query),
    queryFn: () => adminService.listShops(query),
    retry: shouldRetryQuery,
  });
}
