import {
  authUserSchema,
  type AuthUser,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// accessToken/refreshToken không nằm trong response — BE set qua httpOnly
// cookie (xem AuthController), FE chỉ nhận lại `user`.
export async function login(values: LoginInput): Promise<AuthUser> {
  const data = await apiFetch<{ user: unknown }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return authUserSchema.parse(data.user);
}

export async function register(values: RegisterInput): Promise<AuthUser> {
  const data = await apiFetch<{ user: unknown }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return authUserSchema.parse(data.user);
}

export async function me(): Promise<AuthUser> {
  const data = await apiFetch<{ user: unknown }>('/auth/me', { method: 'GET' });
  return authUserSchema.parse(data.user);
}

export async function refresh(): Promise<void> {
  await apiFetch<{ message: string }>('/auth/refresh', { method: 'POST' });
}

export async function logout(): Promise<void> {
  await apiFetch<{ message: string }>('/auth/logout', { method: 'POST' });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

// Yêu cầu đã đăng nhập (JwtAuthGuard) — BE tránh nhận email qua body để
// không lộ email nào tồn tại trong hệ thống (xem AuthService.resendVerification).
export async function resendVerification(): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/resend-verification', {
    method: 'POST',
  });
}

// Công khai, không cần đăng nhập. BE luôn trả cùng một phản hồi dù email có tài khoản hay không (để không
// lộ tài khoản nào tồn tại — xem AuthService.forgotPassword), nên FE cũng không được suy ra gì từ kết quả:
// thành công chỉ nghĩa là "yêu cầu đã được nhận".
export async function forgotPassword(values: ForgotPasswordInput): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(values),
  });
}

// Công khai, xác thực bằng token trong email (dùng một lần). Không tự đăng nhập — BE chỉ đổi mật khẩu và
// thu hồi mọi phiên refresh; FE chuyển sang /login. Token sai/hết hạn/đã dùng đều ra RESET_TOKEN_INVALID.
export async function resetPassword(values: ResetPasswordInput): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(values),
  });
}
