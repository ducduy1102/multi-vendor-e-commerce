import { NextRequest, NextResponse } from "next/server";

// Tên cookie phải khớp ACCESS_TOKEN_COOKIE ở
// apps/api/src/modules/auth/auth.constants.ts.
const ACCESS_TOKEN_COOKIE = "access_token";

// Chỉ chặn route dành cho guest (login/register) khi đã có session — phân
// quyền theo role cho các route cần bảo vệ (Guest/User/Seller/Admin) làm ở
// Bước 3.6 khi có route thật cần bảo vệ.
export function proxy(request: NextRequest) {
  const isAuthenticated = request.cookies.has(ACCESS_TOKEN_COOKIE);

  if (isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/register"],
};
