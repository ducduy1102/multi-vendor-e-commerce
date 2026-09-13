import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";

// Tên cookie phải khớp ACCESS_TOKEN_COOKIE ở
// apps/api/src/modules/auth/auth.constants.ts.
const ACCESS_TOKEN_COOKIE = "access_token";
const GUEST_ONLY_PATHS = ["/login", "/register"];
// Chỉ check "đã đăng nhập chưa" (đọc được từ cookie tại edge) — KHÔNG check
// "đã có shop chưa" ở đây (cần query DB, useMyShop() ở Client Component lo
// việc đó, xem BecomeSellerFormContainer/ShopDashboardContainer Bước 3.7/3.8).
const PROTECTED_PATH_PREFIXES = ["/seller"];

const intlMiddleware = createIntlMiddleware(routing);

// Bỏ prefix locale (chỉ "en" có prefix, "vi" mặc định không có — xem
// i18n/routing.ts) để so khớp path guest-only không phụ thuộc locale hiện
// tại (vd "/en/login" và "/login" đều phải bị chặn như nhau khi đã đăng nhập).
function stripLocalePrefix(pathname: string): string {
  const match = pathname.match(/^\/(en)(?=\/|$)/);
  return match ? pathname.slice(match[0].length) || "/" : pathname;
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Chặn route dành cho guest (login/register) khi đã có session, và chặn
// route cần đăng nhập (/seller/*, Tuần 3 Bước 3.9) khi chưa có session —
// phân quyền theo role (Seller/Admin) làm ở phase sau khi có route thật cần.
export function proxy(request: NextRequest) {
  const isAuthenticated = request.cookies.has(ACCESS_TOKEN_COOKIE);
  const pathWithoutLocale = stripLocalePrefix(request.nextUrl.pathname);

  if (isAuthenticated && GUEST_ONLY_PATHS.includes(pathWithoutLocale)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isAuthenticated && isProtectedPath(pathWithoutLocale)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return intlMiddleware(request);
}

export const config = {
  // Bỏ qua asset tĩnh/API/file có phần mở rộng — đúng matcher mặc định
  // next-intl khuyến nghị, cần chạy trên hầu hết mọi route để tự thêm/detect
  // locale prefix, không chỉ riêng /login, /register như trước khi có i18n.
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
