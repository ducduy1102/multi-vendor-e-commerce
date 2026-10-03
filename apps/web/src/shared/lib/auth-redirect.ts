import { safeNextPath } from '@ecommerce/types';

// Route chỉ dành cho guest — đã đăng nhập mà ghé vào thì đẩy đi chỗ khác.
const GUEST_ONLY_PATHS = ['/login', '/register'];

// Route cần đăng nhập (Week7.md 1.2 thêm "/checkout" — trước đó chỉ "/seller"
// Tuần 3 Bước 3.9, "/wishlist" Week5.md Bước 3.7, "/orders" Week8.md 3.2). Chỉ
// check được từ cookie ở edge (proxy.ts) — điều kiện cần query DB (đã có shop
// chưa...) đẩy xuống Server/Client Component (rules/frontend.md mục 1). Mỗi
// tiền tố ở đây PHẢI có mặt trong SAFE_NEXT_PATH_ALLOWED_PREFIXES
// (packages/types) — thiếu thì guest bị đẩy về /login mà mất `?next=`.
export const PROTECTED_PATH_PREFIXES = ['/seller', '/wishlist', '/checkout', '/orders'];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
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
  isAuthenticated: boolean;
}

// Quyết định THUẦN cho proxy.ts (Week7.md 3.2) — tách khỏi NextRequest/NextResponse để unit test
// được (proxy.ts trước đó chưa có test nào). Trả về path cần redirect tới (dùng làm tham số thứ 2
// của `new URL(path, request.url)`), hoặc `null` nghĩa là không redirect, cho intlMiddleware chạy
// tiếp bình thường.
export function decideAuthRedirect({
  pathname,
  search,
  isAuthenticated,
}: AuthRedirectInput): string | null {
  if (isAuthenticated && GUEST_ONLY_PATHS.includes(pathname)) {
    const requestedNext = safeNextPath(readNextParam(search));
    return requestedNext ?? '/';
  }

  if (!isAuthenticated && isProtectedPath(pathname)) {
    // Đích quay lại sau khi login — validate lại bằng chính hàm dùng ở BE (packages/types),
    // dù về lý thuyết pathname luôn khớp allow-list vì nó chính là PROTECTED_PATH_PREFIXES.
    const next = safeNextPath(`${pathname}${search}`);
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  }

  return null;
}
