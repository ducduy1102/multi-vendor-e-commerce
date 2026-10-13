import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminRefundListQuery } from '../types';
import { adminRefundListQueryKey } from './admin-query-keys';

// Sổ cái hoàn tiền cho Admin (mặc định NEEDS_ACTION: khoản FAILED + PENDING bị bỏ dở quá 5 phút — đúng tập
// thử lại/ghi nhận thủ công được). 401/403 không thử lại, lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminRefunds(query: Partial<AdminRefundListQuery> = {}) {
  return useQuery({
    queryKey: adminRefundListQueryKey(query),
    queryFn: () => adminService.listRefunds(query),
    retry: shouldRetryQuery,
  });
}
