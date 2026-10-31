import { adminReportListQuerySchema } from '@ecommerce/types';
import { z } from 'zod';

import { DEFAULT_ADMIN_REPORT_FILTER } from './admin-report-display';
import type { AdminReportListFilter, ReportTargetType } from './types';

export interface AdminReportsPageQuery {
  status: AdminReportListFilter;
  // undefined = mọi loại.
  targetType: ReportTargetType | undefined;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const reportIdSchema = z.string().uuid();

// Id báo cáo trên đường dẫn `/admin/reports/[id]`: chỉ UUID hợp lệ mới được đi tiếp (sai dạng ⇒ null ⇒ page trả 404, không gọi API).
export function parseAdminReportId(raw: string): string | null {
  const parsed = reportIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Đọc `?status=&type=&page=` do page.tsx truyền qua searchParams (rules/frontend.md mục 2): giá trị sai dạng rơi về mặc định (tab chờ xử lý,
// mọi loại, trang 1) thay vì làm sập trang. Dùng chính schema của BE nên FE không tự định nghĩa lại luật.
export function parseAdminReportsPageQuery(raw: RawSearchParams): AdminReportsPageQuery {
  const status = adminReportListQuerySchema.shape.status.safeParse(firstValue(raw.status));
  const targetType = adminReportListQuerySchema.shape.targetType.safeParse(firstValue(raw.type));
  const page = adminReportListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  return {
    status: status.success ? status.data : DEFAULT_ADMIN_REPORT_FILTER,
    targetType: targetType.success ? targetType.data : undefined,
    page: page.success ? page.data : 1,
  };
}
