import { accountStatusSchema } from '@ecommerce/types';

import type { AdminShopBadgeTone } from './admin-status-display';
import type { AccountStatus, AdminUser, UserRole } from './types';

// Cách hiển thị 1 trạng thái tài khoản: key i18n (namespace `admin`) + sắc thái Badge. Cùng bộ tông ngữ nghĩa với trạng
// thái shop (admin-status-display.ts): `success` cho tài khoản đang dùng bình thường, `warning` cho tạm khoá (còn mở lại
// được), `destructive` cho bị cấm (mức nặng), `muted` cho tài khoản người dùng tự xoá (không phải việc của Admin).
// Accent (cam) không dùng cho trạng thái.
export const ADMIN_USER_STATUS_DISPLAY: Record<
  AccountStatus,
  { labelKey: string; emptyKey: string; tone: AdminShopBadgeTone }
> = {
  ACTIVE: { labelKey: 'accountStatusActive', emptyKey: 'usersEmptyActive', tone: 'success' },
  SUSPENDED: {
    labelKey: 'accountStatusSuspended',
    emptyKey: 'usersEmptySuspended',
    tone: 'warning',
  },
  BANNED: { labelKey: 'accountStatusBanned', emptyKey: 'usersEmptyBanned', tone: 'destructive' },
  DEACTIVATED: {
    labelKey: 'accountStatusDeactivated',
    emptyKey: 'usersEmptyDeactivated',
    tone: 'muted',
  },
};

export interface AdminUserTab {
  // undefined = tab "Tất cả" (BE không lọc theo trạng thái khi bỏ trống `status`).
  status: AccountStatus | undefined;
  labelKey: string;
}

// "Tất cả" đứng đầu và là mặc định (không cần `?status=` trên URL); các tab sau theo đúng thứ tự enum dùng chung — đều là
// trạng thái BE lọc được, không có tab nào "giả" trên dữ liệu đã phân trang.
export const ADMIN_USER_TABS: readonly AdminUserTab[] = [
  { status: undefined, labelKey: 'usersTabAll' },
  ...accountStatusSchema.options.map((status) => ({
    status,
    labelKey: ADMIN_USER_STATUS_DISPLAY[status].labelKey,
  })),
];

export interface AdminUserRoleFilter {
  // undefined = mọi vai.
  role: UserRole | undefined;
  labelKey: string;
}

export const ADMIN_USER_ROLE_FILTERS: readonly AdminUserRoleFilter[] = [
  { role: undefined, labelKey: 'usersRoleAll' },
  { role: 'USER', labelKey: 'usersRoleUser' },
  { role: 'ADMIN', labelKey: 'usersRoleAdmin' },
];

export interface AdminUserDateInfo {
  at: string;
  captionKey: string;
}

// Cột thời điểm: tài khoản đang bị khoá/cấm thì hiện MỐC BỊ KHOÁ/CẤM (Admin cần biết khoá từ khi nào), còn lại hiện ngày
// tham gia. Thiếu `statusChangedAt` (dữ liệu cũ) thì rơi về ngày tham gia thay vì hiện ngày rỗng.
export function getAdminUserDateInfo(
  user: Pick<AdminUser, 'accountStatus' | 'statusChangedAt' | 'createdAt'>,
): AdminUserDateInfo {
  if (user.statusChangedAt) {
    if (user.accountStatus === 'SUSPENDED') {
      return { at: user.statusChangedAt, captionKey: 'usersCaptionSuspendedAt' };
    }
    if (user.accountStatus === 'BANNED') {
      return { at: user.statusChangedAt, captionKey: 'usersCaptionBannedAt' };
    }
  }
  return { at: user.createdAt, captionKey: 'usersCaptionJoined' };
}

// Chữ cái hiển thị trong avatar: chữ đầu của TỪ CUỐI trong tên (cách người Việt gọi tên). Tên rỗng/toàn khoảng trắng
// (không nên có nhưng dữ liệu không do FE kiểm soát) rơi về "?" thay vì ném lỗi làm sập cả bảng.
export function getUserInitial(name: string): string {
  const lastWord = name.trim().split(/\s+/).pop() ?? '';
  const first = Array.from(lastWord)[0];
  return first ? first.toUpperCase() : '?';
}

export type AdminUsersEmptyKind = 'search' | 'filter' | 'tab' | 'all';

// Danh sách rỗng vì sao: tìm theo từ khoá không ra (kèm từ khoá trong câu), lọc theo vai không ra, tab trạng thái chưa có
// ai (câu riêng theo trạng thái), hay sàn chưa có người dùng nào. Hai loại đầu có nút "Xoá bộ lọc"; hai loại sau thì không
// (không có gì để bỏ).
export function getAdminUsersEmptyKind(query: {
  status?: AccountStatus;
  role?: UserRole;
  q?: string;
}): AdminUsersEmptyKind {
  if (query.q) return 'search';
  if (query.role) return 'filter';
  if (query.status) return 'tab';
  return 'all';
}
