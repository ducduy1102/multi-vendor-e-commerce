import {
  authUserSchema,
  type AuthUser,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Chỉ gọi API, không có logic UI. Endpoint tài khoản nằm trong module `auth` của BE (không có module
// `account` ở apps/api — rules/general.md mục 1), còn UI quản lý tài khoản thuộc module `account` của FE
// nên service nằm ở đây.

// `PATCH /auth/me` — chỉ tên và ngôn ngữ email. Trả user mới để Container ghi vào `useAuthStore`
// (nguồn duy nhất cho user hiện tại, không refetch bằng React Query — rules/frontend.md mục 3).
export async function updateProfile(input: UpdateProfileInput): Promise<AuthUser> {
  const data = await apiFetch<{ user: unknown }>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return authUserSchema.parse(data.user);
}

// `POST /auth/change-password` — BE cấp lại cookie cho phiên hiện tại (thiết bị này vẫn đăng nhập) và thu
// hồi refresh token cũ. Response chỉ có `message`, không có user: `hasPassword` không đổi nên FE không cần
// cập nhật store.
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiFetch<{ message: string }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
