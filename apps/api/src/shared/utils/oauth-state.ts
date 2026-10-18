import { safeNextPath } from '@ecommerce/types';
import { UserLocale } from '@prisma/client';
import { DEFAULT_MAIL_LOCALE, type MailLocale } from '../mail/mail-locale';

// Dữ liệu đi vòng qua Google bằng tham số OAuth `state` (API stateless, không dùng session/cookie): đích quay
// lại sau đăng nhập (`next`, Week7.md 1.2) và ngôn ngữ của trang người dùng bấm "Đăng nhập với Google"
// (Week10.md 2.3 — FE không còn nhớ ngôn ngữ qua cookie nên redirect về FE phải tự gắn prefix `/en`).
//
// `state` ở đây CHỈ là chỗ mang dữ liệu, KHÔNG phải cơ chế chống CSRF (GoogleStrategy không bật state store).
// An toàn vì cả hai giá trị đều bị kiểm lại ở cả hai đầu: `next` bằng safeNextPath (allow-list, chặn open
// redirect), `locale` bằng danh sách ngôn ngữ hỗ trợ — dữ liệu đi qua trình duyệt/Google không được tin.
export interface OAuthState {
  next: string | null;
  locale: MailLocale;
}

// Mọi giá trị không phải ngôn ngữ hỗ trợ (thiếu, mảng, object, 'fr'...) rơi về mặc định, không ném lỗi.
export function parseOAuthLocale(value: unknown): MailLocale {
  return typeof value === 'string' &&
    (Object.values(UserLocale) as string[]).includes(value)
    ? (value as MailLocale)
    : DEFAULT_MAIL_LOCALE;
}

// Không có gì để mang (không `next`, ngôn ngữ mặc định) thì không truyền `state` — giữ nguyên URL sang Google
// như trước khi có tính năng này.
export function encodeOAuthState(state: OAuthState): string | undefined {
  const params = new URLSearchParams();
  if (state.next) params.set('n', state.next);
  if (state.locale !== DEFAULT_MAIL_LOCALE) params.set('l', state.locale);
  const encoded = params.toString();
  return encoded === '' ? undefined : encoded;
}

export function decodeOAuthState(raw: unknown): OAuthState {
  if (typeof raw !== 'string' || raw === '') {
    return { next: null, locale: DEFAULT_MAIL_LOCALE };
  }
  // Định dạng cũ: `state` chính là `next` (luôn bắt đầu bằng "/"). Phiên OAuth đang dở lúc deploy vẫn chạy.
  if (raw.startsWith('/')) {
    return { next: safeNextPath(raw), locale: DEFAULT_MAIL_LOCALE };
  }
  const params = new URLSearchParams(raw);
  return {
    next: safeNextPath(params.get('n')),
    locale: parseOAuthLocale(params.get('l')),
  };
}
