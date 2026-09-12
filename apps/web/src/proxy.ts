import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";

// Tên cookie phải khớp ACCESS_TOKEN_COOKIE ở
// apps/api/src/modules/auth/auth.constants.ts.
const ACCESS_TOKEN_COOKIE = "access_token";
const GUEST_ONLY_PATHS = ["/login", "/register"];

const intlMiddleware = createIntlMiddleware(routing);

// Bỏ prefix locale (chỉ "en" có prefix, "vi" mặc định không có — xem
// i18n/routing.ts) để so khớp path guest-only không phụ thuộc locale hiện
// tại (vd "/en/login" và "/login" đều phải bị chặn như nhau khi đã đăng nhập).
function stripLocalePrefix(pathname: string): string {
  const match = pathname.match(/^\/(en)(?=\/|$)/);
  return match ? pathname.slice(match[0].length) || "/" : pathname;
}

// Chỉ chặn route dành cho guest (login/register) khi đã có session — phân
// quyền theo role cho các route cần bảo vệ (Guest/User/Seller/Admin) làm ở
// Bước 3.6 khi có route thật cần bảo vệ.
export function proxy(request: NextRequest) {
  const isAuthenticated = request.cookies.has(ACCESS_TOKEN_COOKIE);
  const pathWithoutLocale = stripLocalePrefix(request.nextUrl.pathname);

  if (isAuthenticated && GUEST_ONLY_PATHS.includes(pathWithoutLocale)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return intlMiddleware(request);
}

export const config = {
  // Bỏ qua asset tĩnh/API/file có phần mở rộng — đúng matcher mặc định
  // next-intl khuyến nghị, cần chạy trên hầu hết mọi route để tự thêm/detect
  // locale prefix, không chỉ riêng /login, /register như trước khi có i18n.
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
