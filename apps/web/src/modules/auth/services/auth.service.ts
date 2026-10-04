import {
  authUserSchema,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
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
