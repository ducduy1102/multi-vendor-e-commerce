import { safeNextPath } from '@ecommerce/types';

import { readJwtRole } from './read-jwt-role';

// Route chỉ dành cho guest — đã đăng nhập mà ghé vào thì đẩy đi chỗ khác.
const GUEST_ONLY_PATHS = ['/login', '/register'];

// Route cần đăng nhập (Week7.md 1.2 thêm "/checkout" — trước đó chỉ "/seller"
// Tuần 3 Bước 3.9, "/wishlist" Week5.md Bước 3.7, "/orders" Week8.md 3.2, "/admin" Week8.md 3.9, "/account" Week9.md 6.2).
// Chỉ check được từ cookie ở edge (proxy.ts) — điều kiện cần query DB (đã có shop chưa...) đẩy
// xuống Server/Client Component (rules/frontend.md mục 1). Mỗi tiền tố ở đây PHẢI có mặt trong
// SAFE_NEXT_PATH_ALLOWED_PREFIXES (packages/types) — thiếu thì guest bị đẩy về /login mà mất
// `?next=`.
export const PROTECTED_PATH_PREFIXES = [
  '/seller',
  '/wishlist',
  '/checkout',
  '/orders',
  '/admin',
  '/account',
];

// Khu quản trị — đã đăng nhập nhưng KHÔNG phải ADMIN thì bị đẩy về trang chủ. Role đọc từ payload JWT
// không verify (readJwtRole) nên đây chỉ là điều hướng UX; quyền thật nằm ở RolesGuard của BE.
export const ADMIN_PATH_PREFIX = '/admin';
const ADMIN_ROLE = 'ADMIN';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

// `search` dạng chuỗi thô của URL ("" hoặc "?a=1&b=2", giống `NextRequest.nextUrl.search`) —
// tránh phụ thuộc kiểu NextRequest để hàm này thuần, dễ unit test không cần mock Next.js.
function readNextParam(search: string): string | null {
  if (!search) return null;
  return new URLSearchParams(search).get('next');
}

export interface AuthRedirectInput {
  // Pathname ĐÃ bỏ prefix locale (proxy.ts tự strip trước khi gọi — so khớp
  // GUEST_ONLY_PATHS/PROTECTED_PATH_PREFIXES không phụ thuộc locale hiện tại).
  pathname: string;
  search: string;
  // HAI vị từ khác nhau (Week10.md 2.1) vì access_token chỉ sống 15 phút còn refresh_token 7 ngày:
  // - `isAuthenticated`: có access_token, tức "đã đăng nhập thật". Chỉ dùng cho route CHỈ DÀNH CHO KHÁCH
  //   (/login, /register). Dùng vị từ rộng hơn ở đây thì người còn refresh cookie cũ/đã bị thu hồi (sống
  //   tới 7 ngày) sẽ bị đẩy khỏi /login mãi và không đăng nhập lại được.
  isAuthenticated: boolean;
  // - `hasSessionTrace`: có access_token HOẶC refresh_token, tức "còn dấu vết phiên". Dùng cho route CẦN
  //   đăng nhập và /admin/*: người chỉ còn refresh token phải được vào để client kịp gia hạn, thay vì bị
  //   đẩy ra /login trước. Không truyền ⇒ bằng `isAuthenticated`.
  hasSessionTrace?: boolean;
  // Role đọc từ cookie (readJwtRole, access_token hoặc refresh_token — cùng payload) — null/thiếu =
  // không đọc được, coi như không phải ADMIN. Chỉ cần cho route /admin/*.
  role?: string | null;
}

export interface SessionCookies {
  accessToken?: string;
  refreshToken?: string;
}

// Suy hai vị từ và role từ giá trị cookie thô — hàm thuần để proxy.ts chỉ còn là lớp nối với
// NextRequest/NextResponse. Cookie rỗng coi như không có. Role ưu tiên access_token, rơi về
// refresh_token khi access_token đã hết hạn/biến mất (cả hai JWT cùng payload `{ sub, role }`).
export function readSessionState({ accessToken, refreshToken }: SessionCookies): {
  isAuthenticated: boolean;
  hasSessionTrace: boolean;
  role: string | null;
} {
  const isAuthenticated = Boolean(accessToken);
  return {
    isAuthenticated,
    hasSessionTrace: isAuthenticated || Boolean(refreshToken),
    role: readJwtRole(accessToken) ?? readJwtRole(refreshToken),
  };
}

// Quyết định THUẦN cho proxy.ts (Week7.md 3.2) — tách khỏi NextRequest/NextResponse để unit test
// được (proxy.ts trước đó chưa có test nào). Trả về path cần redirect tới (dùng làm tham số thứ 2
// của `new URL(path, request.url)`), hoặc `null` nghĩa là không redirect, cho intlMiddleware chạy
// tiếp bình thường.
export function decideAuthRedirect({
  pathname,
  search,
  isAuthenticated,
  hasSessionTrace = isAuthenticated,
  role,
}: AuthRedirectInput): string | null {
  if (isAuthenticated && GUEST_ONLY_PATHS.includes(pathname)) {
    const requestedNext = safeNextPath(readNextParam(search));
    return requestedNext ?? '/';
  }

  if (!hasSessionTrace && isProtectedPath(pathname)) {
    // Đích quay lại sau khi login — validate lại bằng chính hàm dùng ở BE (packages/types),
    // dù về lý thuyết pathname luôn khớp allow-list vì nó chính là PROTECTED_PATH_PREFIXES.
    const next = safeNextPath(`${pathname}${search}`);
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  }

  // Về "/" thay vì 403/404 riêng để không lộ route quản trị tồn tại cho người không có quyền.
  if (hasSessionTrace && matchesPrefix(pathname, ADMIN_PATH_PREFIX) && role !== ADMIN_ROLE) {
    return '/';
  }

  return null;
}
