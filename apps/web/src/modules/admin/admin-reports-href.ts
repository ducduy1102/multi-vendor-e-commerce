import { DEFAULT_ADMIN_REPORT_FILTER } from './admin-report-display';
import type { AdminReportListFilter, ReportTargetType } from './types';

export const ADMIN_REPORTS_PATH = '/admin/reports';

interface AdminReportsLocation {
  status?: AdminReportListFilter;
  targetType?: ReportTargetType;
  page?: number;
}

// Dựng URL hàng đợi báo cáo: chỉ ghi tham số KHÁC mặc định (tab chờ xử lý, mọi loại, trang 1) nên URL gọn và có đúng một dạng cho mỗi
// trạng thái.
export function buildAdminReportsHref({
  status,
  targetType,
  page,
}: AdminReportsLocation = {}): string {
  const searchParams = new URLSearchParams();
  if (status && status !== DEFAULT_ADMIN_REPORT_FILTER) searchParams.set('status', status);
  if (targetType) searchParams.set('type', targetType);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${ADMIN_REPORTS_PATH}?${query}` : ADMIN_REPORTS_PATH;
}

// Trang chi tiết một báo cáo. `id` đi vào đường dẫn nên được mã hoá.
export function buildAdminReportDetailHref(reportId: string): string {
  return `${ADMIN_REPORTS_PATH}/${encodeURIComponent(reportId)}`;
}

interface PaginationInput extends AdminReportsLocation {
  page: number;
  total: number;
  limit: number;
}

export interface AdminReportsPagination {
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

export function buildAdminReportsPagination({
  status,
  targetType,
  page,
  total,
  limit,
}: PaginationInput): AdminReportsPagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildAdminReportsHref({
      status,
      targetType,
      page: Math.max(1, Math.min(page - 1, totalPages)),
    }),
    nextHref: buildAdminReportsHref({
      status,
      targetType,
      page: Math.min(page + 1, totalPages),
    }),
  };
}
