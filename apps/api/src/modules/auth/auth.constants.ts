import type { CookieOptions } from 'express';
import { frontendUrl } from '../../shared/mail/frontend-url';
import type { MailLocale } from '../../shared/mail/mail-locale';
import { getFrontendUrl } from '../../shared/utils/frontend-url';
import { readPositiveInt } from '../../shared/utils/read-positive-int';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../../shared/utils/session-cookie-names';

// Tên cookie định nghĩa ở shared/ (hạ tầng real-time cũng đọc access_token); re-export để giữ nguyên import cũ.
export { getFrontendUrl, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE };

// Phải khớp default của JWT_ACCESS_EXPIRES_IN/JWT_REFRESH_EXPIRES_IN ở
// auth.service.ts (15m/7d) — đổi env đó thì đổi luôn 2 hằng số maxAge này.
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// `Domain` của cookie đăng nhập (Week9.md 8.3). Đặt `.<domain>` để cookie do `api.<domain>` set cũng được
// gửi tới `app.<domain>` — `proxy.ts` của web đọc `access_token` ở đó. Không đặt ⇒ cookie chỉ gắn với host
// của API (đúng cho local). Đọc LÚC DÙNG, không lúc boot (rules/backend.md mục 8); `VAR=` (chuỗi rỗng)
// cũng ⇒ không đặt (rules/general.md mục 4). Chỉ đặt ở staging/production, KHÔNG đặt ở local: trình duyệt bỏ
// cookie có `Domain=localhost`.
function readCookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN?.trim() || undefined;
}

function baseCookieOptions(): CookieOptions {
  const domain = readCookieDomain();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function accessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: ACCESS_TOKEN_MAX_AGE_MS };
}

export function refreshTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: REFRESH_TOKEN_MAX_AGE_MS };
}

// Option khi XOÁ cookie: trình duyệt chỉ xoá khi Domain/Path/Secure/SameSite KHỚP HỆT lúc đặt (trừ
// maxAge/expires) — lệch một thuộc tính thì cookie cũ còn nguyên và đăng xuất không kết thúc được phiên.
// Lấy từ cùng `baseCookieOptions` với hai hàm trên nên không thể lệch; cố ý không kèm `maxAge`.
export function clearTokenCookieOptions(): CookieOptions {
  return baseCookieOptions();
}

// Token verify email dùng 1 lần, hết hạn sau 24h. Cooldown chống spam bấm
// "gửi lại" liên tục — không phải rate-limit toàn hệ thống (việc đó thuộc
// Phase 5), chỉ là safeguard tối thiểu cho riêng flow này.
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

// Quên mật khẩu (Week9.md 1.11): cooldown theo user giữa hai lần GỬI link (trong cooldown vẫn trả cùng phản
// hồi như bình thường, không báo gì — báo "gửi quá nhanh" sẽ lộ email có tài khoản). Chưa có rate limit toàn
// hệ thống (Tuần 12), đây là rào tối thiểu cho riêng luồng này.
export const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;

// Hạn dùng của link đặt lại mật khẩu, đọc LÚC DÙNG (không lúc boot). Mặc định 60 phút; kẹp tối đa 24 giờ
// để một giá trị cấu hình nhầm không biến link thành thứ sống cả tuần.
export const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 60;
export const MAX_PASSWORD_RESET_TTL_MINUTES = 24 * 60;
export function readPasswordResetTtlMinutes(): number {
  return Math.min(
    readPositiveInt(
      'PASSWORD_RESET_TTL_MINUTES',
      DEFAULT_PASSWORD_RESET_TTL_MINUTES,
    ),
    MAX_PASSWORD_RESET_TTL_MINUTES,
  );
}

// Đích redirect sau Google OAuth callback. `next` phải là kết quả của safeNextPath (đã kiểm) hoặc
// null; không có next thì về trang chủ. `locale` là ngôn ngữ của trang người dùng đã bấm nút Google (đi vòng
// qua `state`): FE không còn nhớ ngôn ngữ qua cookie (Week10.md 2.3) nên URL phải tự mang prefix `/en`.
export function googleSuccessRedirectUrl(
  next: string | null,
  locale: MailLocale,
): string {
  return frontendUrl(next ?? '/', locale);
}

// Nhánh lỗi giữ lại next để người dùng đăng nhập lại bằng cách khác vẫn quay về đúng chỗ.
export function googleFailureRedirectUrl(
  reason: string,
  next: string | null,
  locale: MailLocale,
): string {
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : '';
  return frontendUrl(`/login?error=${reason}${nextParam}`, locale);
}
