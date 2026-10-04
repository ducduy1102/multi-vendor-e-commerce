// Đích quay lại sau khi đăng nhập (`?next=`). Giá trị này đi qua trình duyệt/URL nên là dữ liệu
// KHÔNG tin được — nếu chấp nhận bừa sẽ thành open redirect (đưa người dùng vừa đăng nhập sang
// trang lừa đảo). Cả FE (proxy/login) lẫn BE (Google OAuth callback) đều gọi hàm này, định nghĩa
// 1 lần ở đây (Week7.md 1.2).
//
// Chỉ nhận đường dẫn NỘI BỘ, KHÔNG kèm locale (vd `/checkout`, `/cart?x=1`; router của next-intl tự
// thêm locale hiện tại), và chỉ nhận theo DANH SÁCH CHO PHÉP tiền tố — `next` chỉ được sinh ra từ
// proxy.ts/nút thanh toán của chính app nên allow-list chặt hơn cấm-thủ-công (không sót vector lạ).
export const SAFE_NEXT_PATH_ALLOWED_PREFIXES: readonly string[] = [
  '/checkout',
  '/cart',
  '/seller',
  '/wishlist',
  '/orders',
  '/products',
  '/admin',
];

export const SAFE_NEXT_PATH_MAX_LENGTH = 256;

// Ký tự điều khiển (kể cả xuống dòng → header injection) và dấu `\` (trình duyệt coi như `/`).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\]/;

// Giải mã %-encoding tối đa 2 lớp (chống `%252f`); giải mã lỗi ⇒ coi là không an toàn.
function decodeLayers(value: string): string[] | null {
  const layers = [value];
  try {
    for (let i = 0; i < 2; i++) {
      layers.push(decodeURIComponent(layers[layers.length - 1]));
    }
  } catch {
    return null;
  }
  return layers;
}

// Trả đường dẫn gốc (chưa giải mã) nếu an toàn, ngược lại null. Không bao giờ ném lỗi.
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > SAFE_NEXT_PATH_MAX_LENGTH) return null;

  const layers = decodeLayers(raw);
  if (!layers) return null;

  for (const layer of layers) {
    if (FORBIDDEN_CHARS.test(layer)) return null;
    // Phải là đường dẫn tuyệt đối trong cùng origin: đúng 1 dấu `/` đầu, không `//` (protocol-relative).
    if (!layer.startsWith('/') || layer.startsWith('//')) return null;
  }

  // Phần path (trước ? hoặc #) của lớp đã giải mã hết: không có dot-segment, khớp allow-list.
  const decoded = layers[layers.length - 1];
  const path = decoded.split(/[?#]/, 1)[0];
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;

  const isAllowed = SAFE_NEXT_PATH_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return isAllowed ? raw : null;
}
