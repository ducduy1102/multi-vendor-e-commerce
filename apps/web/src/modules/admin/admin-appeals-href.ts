import { DEFAULT_ADMIN_APPEAL_FILTER } from './admin-appeal-display';
import type { AdminAppealListFilter } from './types';

export const ADMIN_APPEALS_PATH = '/admin/appeals';

interface AdminAppealsLocation {
  status?: AdminAppealListFilter;
  page?: number;
}

// URL của trang kháng nghị — bỏ param nào là mặc định (PENDING, trang 1) để link gọn và trùng với URL người dùng tự gõ. Không kèm
// locale: Link của next-intl tự thêm.
export function buildAdminAppealsHref({ status, page }: AdminAppealsLocation = {}): string {
  const searchParams = new URLSearchParams();
  if (status && status !== DEFAULT_ADMIN_APPEAL_FILTER) searchParams.set('status', status);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${ADMIN_APPEALS_PATH}?${query}` : ADMIN_APPEALS_PATH;
}

interface PaginationInput extends AdminAppealsLocation {
  page: number;
  total: number;
  limit: number;
}

export interface AdminAppealsPagination {
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

// `totalPages` tối thiểu 1 (danh sách rỗng vẫn là "trang 1/1"). Trang hiện tại có thể VƯỢT totalPages (gõ tay ?page=99, hoặc quyết
// định xong kháng nghị cuối của trang cuối làm trang đó biến mất) — khi đó "Trang trước" nhảy thẳng về trang cuối thật thay vì
// page - 1 (vẫn rỗng), còn "Trang sau" giữ nguyên trang hiện tại.
export function buildAdminAppealsPagination({
  status,
  page,
  total,
  limit,
}: PaginationInput): AdminAppealsPagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildAdminAppealsHref({ status, page: Math.max(1, Math.min(page - 1, totalPages)) }),
    nextHref: buildAdminAppealsHref({ status, page: Math.min(page + 1, totalPages) }),
  };
}
