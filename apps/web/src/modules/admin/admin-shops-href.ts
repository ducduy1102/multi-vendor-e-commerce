import { DEFAULT_ADMIN_SHOP_STATUS } from './admin-status-display';
import type { ShopStatus } from './types';

export const ADMIN_SHOPS_PATH = '/admin/shops';

interface AdminShopsLocation {
  status?: ShopStatus;
  page?: number;
}

// URL của trang duyệt shop — bỏ param nào là mặc định (PENDING, trang 1) để link gọn và trùng với URL
// người dùng tự gõ. Không kèm locale: Link của next-intl tự thêm.
export function buildAdminShopsHref({ status, page }: AdminShopsLocation = {}): string {
  const searchParams = new URLSearchParams();
  if (status && status !== DEFAULT_ADMIN_SHOP_STATUS) searchParams.set('status', status);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${ADMIN_SHOPS_PATH}?${query}` : ADMIN_SHOPS_PATH;
}

interface PaginationInput extends AdminShopsLocation {
  page: number;
  total: number;
  limit: number;
}

export interface AdminShopsPagination {
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

// `totalPages` tối thiểu 1 (danh sách rỗng vẫn là "trang 1/1"). Trang hiện tại có thể VƯỢT totalPages
// (gõ tay ?page=99, hoặc duyệt xong shop cuối của trang cuối làm trang đó biến mất) — khi đó
// "Trang trước" nhảy thẳng về trang cuối thật thay vì page - 1 (vẫn rỗng), còn "Trang sau" giữ
// nguyên trang hiện tại (không có trang nào sau nó).
export function buildAdminShopsPagination({
  status,
  page,
  total,
  limit,
}: PaginationInput): AdminShopsPagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildAdminShopsHref({ status, page: Math.max(1, Math.min(page - 1, totalPages)) }),
    nextHref: buildAdminShopsHref({ status, page: Math.min(page + 1, totalPages) }),
  };
}
