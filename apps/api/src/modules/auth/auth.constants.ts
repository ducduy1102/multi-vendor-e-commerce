import type { CookieOptions } from 'express';

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
