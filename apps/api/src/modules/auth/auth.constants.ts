import type { CookieOptions } from 'express';
import { getFrontendUrl } from '../../shared/utils/frontend-url';

export { getFrontendUrl };

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Phải khớp default của JWT_ACCESS_EXPIRES_IN/JWT_REFRESH_EXPIRES_IN ở
// auth.service.ts (15m/7d) — đổi env đó thì đổi luôn 2 hằng số maxAge này.
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

export function accessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: ACCESS_TOKEN_MAX_AGE_MS };
}

export function refreshTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: REFRESH_TOKEN_MAX_AGE_MS };
}

// Token verify email dùng 1 lần, hết hạn sau 24h. Cooldown chống spam bấm
// "gửi lại" liên tục — không phải rate-limit toàn hệ thống (việc đó thuộc
// Phase 5), chỉ là safeguard tối thiểu cho riêng flow này.
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

// Đích redirect sau Google OAuth callback. `next` phải là kết quả của safeNextPath (đã kiểm) hoặc
// null; không có next thì về trang chủ như trước khi có tính năng này.
export function googleSuccessRedirectUrl(next: string | null): string {
  return `${getFrontendUrl()}${next ?? ''}`;
}

// Nhánh lỗi giữ lại next để người dùng đăng nhập lại bằng cách khác vẫn quay về đúng chỗ.
export function googleFailureRedirectUrl(
  reason: string,
  next: string | null,
): string {
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : '';
  return `${getFrontendUrl()}/login?error=${reason}${nextParam}`;
}
