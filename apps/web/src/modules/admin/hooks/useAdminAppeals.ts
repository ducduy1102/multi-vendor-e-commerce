import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminAppealListQuery } from '../types';
import { adminAppealListQueryKey } from './admin-query-keys';

// Hàng đợi kháng nghị theo bộ lọc cho Admin (mặc định chờ xử lý). 401/403 không thử lại (kết quả chắc chắn), lỗi tạm thời thử lại
// tối đa 2 lần.
export function useAdminAppeals(query: Partial<AdminAppealListQuery> = {}) {
  return useQuery({
    queryKey: adminAppealListQueryKey(query),
    queryFn: () => adminService.listAppeals(query),
    retry: shouldRetryQuery,
  });
}
