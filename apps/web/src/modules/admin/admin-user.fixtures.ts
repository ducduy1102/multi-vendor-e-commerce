import type { AdminUser, AdminUserDetail } from './types';

// Dữ liệu mẫu dùng chung cho test màn /admin/users (không phải test, không có logic).
export const USER_ID = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';

export const ACTIVE_USER: AdminUser = {
  id: USER_ID,
  email: 'an.nguyen@example.com',
  name: 'Nguyễn Văn An',
  role: 'USER',
  accountStatus: 'ACTIVE',
  statusReason: null,
  statusChangedAt: null,
  isEmailVerified: true,
  createdAt: '2026-03-02T08:00:00.000Z',
};

export function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return { ...ACTIVE_USER, ...overrides };
}

export function makeDetail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...ACTIVE_USER,
    locale: 'vi',
    orderCount: 5,
    shops: [],
    history: [],
    ...overrides,
  };
}
