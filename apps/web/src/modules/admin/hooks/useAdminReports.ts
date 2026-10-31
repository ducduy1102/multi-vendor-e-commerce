import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminReportListQuery } from '../types';
import { adminReportListQueryKey } from './admin-query-keys';

// Hàng đợi báo cáo vi phạm theo tab + loại + trang. Khoá cache chứa đúng bộ lọc nên đổi tab / loại / trang là một truy vấn khác.
export function useAdminReports(query: Partial<AdminReportListQuery> = {}) {
  return useQuery({
    queryKey: adminReportListQueryKey(query),
    queryFn: () => adminService.listReports(query),
    retry: shouldRetryQuery,
  });
}
