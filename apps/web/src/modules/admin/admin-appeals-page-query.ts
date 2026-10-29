import { adminAppealListQuerySchema } from '@ecommerce/types';

import { DEFAULT_ADMIN_APPEAL_FILTER } from './admin-appeal-display';
import type { AdminAppealListFilter } from './types';

export interface AdminAppealsPageQuery {
  status: AdminAppealListFilter;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?status=a&status=b) ra mảng — chỉ lấy giá trị đầu, giống một param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?status=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: từng param sai dạng rơi về mặc
// định ĐỘC LẬP (status lạ không làm mất trang đang xem, và ngược lại), không bao giờ ném lỗi làm sập trang. Dùng lại chính schema
// BE (status enum, page coerce có trần) để hai phía không lệch luật.
export function parseAdminAppealsPageQuery(raw: RawSearchParams): AdminAppealsPageQuery {
  const status = adminAppealListQuerySchema.shape.status.safeParse(firstValue(raw.status));
  const page = adminAppealListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  return {
    status: status.success ? status.data : DEFAULT_ADMIN_APPEAL_FILTER,
    page: page.success ? page.data : 1,
  };
}
