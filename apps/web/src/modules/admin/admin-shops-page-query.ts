import { adminShopListQuerySchema } from '@ecommerce/types';

import { DEFAULT_ADMIN_SHOP_STATUS } from './admin-status-display';
import type { ShopStatus } from './types';

export interface AdminShopsPageQuery {
  status: ShopStatus;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?status=a&status=b) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?status=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin:
// từng param sai dạng rơi về mặc định ĐỘC LẬP (status lạ không làm mất trang đang xem, và ngược
// lại), không bao giờ ném lỗi làm sập trang. Dùng lại chính schema BE (status enum, page coerce) để
// 2 phía không lệch luật.
export function parseAdminShopsPageQuery(raw: RawSearchParams): AdminShopsPageQuery {
  const status = adminShopListQuerySchema.shape.status.safeParse(firstValue(raw.status));
  const page = adminShopListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  return {
    status: status.success ? status.data : DEFAULT_ADMIN_SHOP_STATUS,
    page: page.success ? page.data : 1,
  };
}
