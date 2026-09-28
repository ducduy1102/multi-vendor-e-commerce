import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

import { routing } from '@/i18n/routing';
import { decideAuthRedirect } from '@/shared/lib/auth-redirect';

// Tên cookie phải khớp ACCESS_TOKEN_COOKIE ở
// apps/api/src/modules/auth/auth.constants.ts.
const ACCESS_TOKEN_COOKIE = 'access_token';

const intlMiddleware = createIntlMiddleware(routing);

// Bỏ prefix locale (chỉ "en" có prefix, "vi" mặc định không có — xem
// i18n/routing.ts) để so khớp path guest-only không phụ thuộc locale hiện
// tại (vd "/en/login" và "/login" đều phải bị chặn như nhau khi đã đăng nhập).
function stripLocalePrefix(pathname: string): string {
  const match = pathname.match(/^\/(en)(?=\/|$)/);
  return match ? pathname.slice(match[0].length) || '/' : pathname;
}

// "" (vi, mặc định không prefix) hoặc "/en". decideAuthRedirect làm việc với
// path đã bỏ locale (đúng hợp đồng safeNextPath: "next" không kèm locale) —
// NextResponse.redirect() ở dưới không đi qua intlMiddleware nên phải tự gắn
// lại locale hiện tại vào path redirect, nếu không sẽ rơi về "vi" mặc định dù
// đang ở "/en/..." (bug thật gặp khi test tay Week7.md 3.2: guest /en/checkout
// bị đẩy về "/login" thay vì "/en/login").
function detectLocalePrefix(pathname: string): string {
  const match = pathname.match(/^\/(en)(?=\/|$)/);
  return match ? `/${match[1]}` : '';
}

function withLocalePrefix(prefix: string, path: string): string {
  if (path === '/') return prefix || '/';
  return `${prefix}${path}`;
}

// Chặn route dành cho guest (login/register) khi đã có session — quay lại
// đúng `?next=` nếu có (Week7.md 1.2/3.2); chặn route cần đăng nhập
// (/seller/*, /wishlist, /checkout) khi chưa có session, giữ lại đích tới
// qua `?next=` để quay lại sau khi login. Phân quyền theo role (Seller/Admin)
// làm ở phase sau khi có route thật cần. Quyết định redirect nằm ở hàm thuần
// decideAuthRedirect (shared/lib/auth-redirect.ts) để unit test được —
// proxy() chỉ nối hàm đó với NextRequest/NextResponse, tự gắn lại locale.
export function proxy(request: NextRequest) {
  const isAuthenticated = request.cookies.has(ACCESS_TOKEN_COOKIE);
  const localePrefix = detectLocalePrefix(request.nextUrl.pathname);
  const pathWithoutLocale = stripLocalePrefix(request.nextUrl.pathname);

  const redirectTo = decideAuthRedirect({
    pathname: pathWithoutLocale,
    search: request.nextUrl.search,
    isAuthenticated,
  });
  if (redirectTo) {
    return NextResponse.redirect(new URL(withLocalePrefix(localePrefix, redirectTo), request.url));
  }

  return intlMiddleware(request);
}

export const config = {
  // Bỏ qua asset tĩnh/API/file có phần mở rộng — đúng matcher mặc định
  // next-intl khuyến nghị, cần chạy trên hầu hết mọi route để tự thêm/detect
  // locale prefix, không chỉ riêng /login, /register như trước khi có i18n.
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
