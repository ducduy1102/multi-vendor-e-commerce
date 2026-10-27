import { accountStatusTargets } from '@ecommerce/types';

import type { AccountStatus, AdminUser, AdminUserSuspendTarget } from './types';

// Bốn hành động Admin làm được với 1 tài khoản. "Mở lại" (tạm khoá → hoạt động) và "Gỡ cấm" (cấm → hoạt động) cùng đích
// ACTIVE nhưng khác điểm xuất phát nên khác nhãn, khác hậu quả với shop (mở lại tự mở shop do lần khoá này đóng; gỡ cấm
// KHÔNG tự mở shop nào) và khác mức cảnh báo trong hộp thoại.
export type AdminUserAction = 'suspend' | 'ban' | 'reactivate' | 'unban';

// Trạng thái ĐÍCH của từng hành động.
export const ADMIN_USER_ACTION_TARGET: Record<AdminUserAction, AccountStatus> = {
  suspend: 'SUSPENDED',
  ban: 'BANNED',
  reactivate: 'ACTIVE',
  unban: 'ACTIVE',
};

// Hành động khoá/cấm gửi lên `POST /admin/users/:id/suspend` kèm `status` đích; mở lại/gỡ cấm đi `reactivate`.
export function getSuspendTarget(action: AdminUserAction): AdminUserSuspendTarget | null {
  return action === 'suspend' ? 'SUSPENDED' : action === 'ban' ? 'BANNED' : null;
}

const ACTION_BY_TRANSITION: Partial<Record<string, AdminUserAction>> = {
  'ACTIVE>SUSPENDED': 'suspend',
  'ACTIVE>BANNED': 'ban',
  'SUSPENDED>BANNED': 'ban',
  'SUSPENDED>ACTIVE': 'reactivate',
  'BANNED>ACTIVE': 'unban',
};

export interface AdminUserActions {
  // Hành động thường dùng, hiện thành nút ngay trên dòng. null = không có.
  primary: AdminUserAction | null;
  // Hành động nặng (cấm), đặt trong menu `…` để không bấm nhầm.
  more: AdminUserAction[];
}

const NONE: AdminUserActions = { primary: null, more: [] };

// Hành động Admin làm được với 1 người dùng — suy từ bảng chuyển trạng thái DÙNG CHUNG với BE (accountStatusTargets) nên
// FE không tự nhớ luật riêng: không bao giờ hiện hành động mà BE sẽ từ chối. Quản trị viên không có hành động nào (BE trả
// 409 CANNOT_MODIFY_ADMIN; tài khoản của chính Admin đang đăng nhập cũng là Admin nên cũng không bị khoá/cấm được), và
// tài khoản người dùng tự xoá (DEACTIVATED) không có cạnh nào đi ra.
export function getAdminUserActions(
  user: Pick<AdminUser, 'role' | 'accountStatus'>,
): AdminUserActions {
  if (user.role === 'ADMIN') return NONE;

  const actions = accountStatusTargets(user.accountStatus).flatMap((target) => {
    const action = ACTION_BY_TRANSITION[`${user.accountStatus}>${target}`];
    return action ? [action] : [];
  });
  return {
    primary: actions.find((action) => action !== 'ban') ?? null,
    more: actions.filter((action) => action === 'ban'),
  };
}
