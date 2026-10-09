import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminRefundRequestListQuery } from '../types';
import { adminRefundRequestListQueryKey } from './admin-query-keys';

// Hàng chờ yêu cầu hủy/trả hàng cho Admin (mặc định tab khiếu nại: ESCALATED, cũ nhất trước). 401/403
// không thử lại (kết quả chắc chắn), lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminRefundRequests(query: Partial<AdminRefundRequestListQuery> = {}) {
  return useQuery({
    queryKey: adminRefundRequestListQueryKey(query),
    queryFn: () => adminService.listRefundRequests(query),
    retry: shouldRetryQuery,
  });
}
