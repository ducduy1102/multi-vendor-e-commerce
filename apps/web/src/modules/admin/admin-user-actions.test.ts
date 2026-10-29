import {
  ADMIN_ACCOUNT_STATUS_TRANSITIONS,
  accountStatusSchema,
  accountStatusTargets,
} from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_USER_ACTION_TARGET,
  getAdminUserActions,
  getSuspendTarget,
  type AdminUserAction,
} from './admin-user-actions';
import type { AccountStatus } from './types';

const user = (accountStatus: AccountStatus, role: 'USER' | 'ADMIN' = 'USER') => ({
  role,
  accountStatus,
});

describe('getAdminUserActions', () => {
  it.each<[AccountStatus, { primary: AdminUserAction | null; more: AdminUserAction[] }]>([
    ['ACTIVE', { primary: 'suspend', more: ['ban'] }],
    ['SUSPENDED', { primary: 'reactivate', more: ['ban'] }],
    ['BANNED', { primary: 'unban', more: [] }],
    ['DEACTIVATED', { primary: null, more: [] }],
  ])('người dùng %s -> %j', (status, expected) => {
    expect(getAdminUserActions(user(status))).toEqual(expected);
  });

  // Lưới an toàn khi bảng chuyển trạng thái dùng chung đổi: thêm cạnh ADMIN mới ở packages/types mà FE chưa có nút tương ứng
  // thì test này đỏ, thay vì Admin lặng lẽ không có cách thực hiện cạnh đó; và ngược lại FE không bao giờ hiện nút BE sẽ từ chối.
  it.each(accountStatusSchema.options)(
    'người dùng %s: tập trạng thái đích của các nút = đúng tập đích trong ADMIN_ACCOUNT_STATUS_TRANSITIONS',
    (status) => {
      const { primary, more } = getAdminUserActions(user(status));
      const actions = [...(primary ? [primary] : []), ...more];
      const targets = actions.map((action) => ADMIN_USER_ACTION_TARGET[action]);

      expect([...targets].sort()).toEqual([...accountStatusTargets(status)].sort());
    },
  );

  it('mọi cạnh của bảng chuyển trạng thái đều có đúng MỘT nút (không cạnh nào bị bỏ sót hay trùng)', () => {
    for (const edge of ADMIN_ACCOUNT_STATUS_TRANSITIONS) {
      const { primary, more } = getAdminUserActions(user(edge.from));
      const matching = [...(primary ? [primary] : []), ...more].filter(
        (action) => ADMIN_USER_ACTION_TARGET[action] === edge.to,
      );

      expect(matching, `${edge.from} -> ${edge.to}`).toHaveLength(1);
    }
  });

  it('Quản trị viên không có hành động nào ở MỌI trạng thái (BE trả 409 CANNOT_MODIFY_ADMIN; Admin đang đăng nhập cũng là Admin nên không tự khoá/cấm được mình)', () => {
    for (const status of accountStatusSchema.options) {
      expect(getAdminUserActions(user(status, 'ADMIN'))).toEqual({ primary: null, more: [] });
    }
  });

  it('"Cấm" luôn nằm trong menu `…` (more), không bao giờ là nút chính', () => {
    for (const status of accountStatusSchema.options) {
      expect(getAdminUserActions(user(status)).primary).not.toBe('ban');
    }
  });

  it('"Mở lại" (từ tạm khoá) và "Gỡ cấm" (từ cấm) cùng đích ACTIVE nhưng không bao giờ cùng xuất hiện trên một tài khoản', () => {
    expect(ADMIN_USER_ACTION_TARGET.reactivate).toBe('ACTIVE');
    expect(ADMIN_USER_ACTION_TARGET.unban).toBe('ACTIVE');
    for (const status of accountStatusSchema.options) {
      const { primary, more } = getAdminUserActions(user(status));
      const all = [...(primary ? [primary] : []), ...more];
      expect(all.includes('reactivate') && all.includes('unban')).toBe(false);
    }
  });

  it('tài khoản đã bị cấm có đường quay về (Gỡ cấm), không bị kẹt không còn nút nào', () => {
    expect(getAdminUserActions(user('BANNED')).primary).toBe('unban');
  });
});

describe('getSuspendTarget', () => {
  it('khoá/cấm gửi kèm mức đích; mở lại/gỡ cấm không có mức (đi endpoint reactivate)', () => {
    expect(getSuspendTarget('suspend')).toBe('SUSPENDED');
    expect(getSuspendTarget('ban')).toBe('BANNED');
    expect(getSuspendTarget('reactivate')).toBeNull();
    expect(getSuspendTarget('unban')).toBeNull();
  });
});
