import type { AdminUsersPageQuery } from './admin-users-page-query';

export const ADMIN_USERS_PATH = '/admin/users';

type AdminUsersLocation = Partial<AdminUsersPageQuery>;

// URL của trang người dùng — bỏ param nào là mặc định (không lọc, không tìm, trang 1, ngăn đóng) để link gọn và trùng với
// URL người dùng tự gõ. Không kèm locale: Link của next-intl tự thêm.
export function buildAdminUsersHref({
  status,
  role,
  q,
  page,
  userId,
}: AdminUsersLocation = {}): string {
  const searchParams = new URLSearchParams();
  if (status) searchParams.set('status', status);
  if (role) searchParams.set('role', role);
  if (q) searchParams.set('q', q);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  if (userId) searchParams.set('u', userId);
  const query = searchParams.toString();
  return query ? `${ADMIN_USERS_PATH}?${query}` : ADMIN_USERS_PATH;
}

interface PaginationInput extends AdminUsersLocation {
  page: number;
  total: number;
  limit: number;
}

export interface AdminUsersPagination {
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

// Như buildAdminShopsPagination: `totalPages` tối thiểu 1; trang hiện tại có thể VƯỢT totalPages (gõ tay ?page=99) — khi đó
// "Trang trước" nhảy thẳng về trang cuối thật, "Trang sau" giữ nguyên. Chuyển trang luôn ĐÓNG ngăn chi tiết (không truyền
// `userId`): người dùng đang xem ở trang cũ không còn nằm trong danh sách mới.
export function buildAdminUsersPagination({
  status,
  role,
  q,
  page,
  total,
  limit,
}: PaginationInput): AdminUsersPagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildAdminUsersHref({
      status,
      role,
      q,
      page: Math.max(1, Math.min(page - 1, totalPages)),
    }),
    nextHref: buildAdminUsersHref({ status, role, q, page: Math.min(page + 1, totalPages) }),
  };
}
