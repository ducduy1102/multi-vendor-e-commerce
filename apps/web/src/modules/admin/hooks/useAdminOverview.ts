import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import { adminOverviewQueryKey } from './admin-query-keys';

// Số "việc đang chờ" của khu Admin. Nav và trang tổng quan cùng gọi hook này với CÙNG key nên chỉ có một lần gọi API;
// mọi hook mutation của Admin làm mới key này khi một việc rời hàng chờ. 401/403 không thử lại (kết quả chắc chắn),
// lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminOverview() {
  return useQuery({
    queryKey: adminOverviewQueryKey(),
    queryFn: adminService.getOverview,
    retry: shouldRetryQuery,
  });
}
