import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminUserListQuery } from '../types';
import { adminUserListQueryKey } from './admin-query-keys';

// Danh sách người dùng cho Admin (lọc trạng thái/vai/từ khoá, phân trang). 401/403/4xx không thử lại (kết quả chắc chắn),
// lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminUsers(query: Partial<AdminUserListQuery> = {}) {
  return useQuery({
    queryKey: adminUserListQueryKey(query),
    queryFn: () => adminService.listUsers(query),
    retry: shouldRetryQuery,
  });
}
