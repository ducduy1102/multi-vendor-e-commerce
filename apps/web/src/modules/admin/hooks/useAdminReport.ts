import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import { adminReportDetailQueryKey } from './admin-query-keys';

// Chi tiết MỘT báo cáo. 404 `REPORT_NOT_FOUND` (id sai / không tồn tại) không thử lại (shouldRetryQuery) nên trang báo lỗi ngay.
export function useAdminReport(reportId: string) {
  return useQuery({
    queryKey: adminReportDetailQueryKey(reportId),
    queryFn: () => adminService.getReport(reportId),
    retry: shouldRetryQuery,
  });
}
