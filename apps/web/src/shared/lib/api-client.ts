import { refreshSession, type RefreshOutcome } from './session-refresh';

// Export để dùng cho những chỗ điều hướng thẳng trình duyệt (không qua
// apiFetch) — vd GoogleLoginButton trỏ <a href> thẳng tới BE.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';

// BE version từ endpoint đầu tiên (Tuần 3 Bước 1.5, app.setGlobalPrefix('api/v1')
// ở apps/api/src/main.ts) — khai 1 chỗ duy nhất, cả apiFetch lẫn chỗ điều
// hướng thẳng trình duyệt (GoogleLoginButton) đều phải tự nối thêm.
export const API_PREFIX = '/api/v1';

// Khớp ApiErrorBody (packages/types) — `code`/`details` chỉ có ở lỗi đã di chuyển sang
// AppException (Week7.md 1.16/2.2c), lỗi cũ (validate Zod...) chỉ có `message`.
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Mã lỗi máy đọc được (Week7.md 1.16) — dùng shared/lib/error-codes.ts (getErrorCode)
    // để narrow về ErrorCode thay vì so message theo chuỗi.
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Các đường dẫn KHÔNG tự gia hạn khi gặp 401: ở đây 401 mang nghĩa nghiệp vụ chứ không phải "access token
// hết hạn" (sai mật khẩu, token xác thực/đặt lại không hợp lệ...) hoặc chính là lệnh gia hạn. Gia hạn rồi
// thử lại ở đây vô nghĩa, riêng `/auth/refresh` còn gây vòng lặp. `/auth/logout` CỐ Ý không nằm trong danh
// sách: nó dùng JwtAuthGuard nên khi access token đã hết hạn sẽ 401 và KHÔNG thu hồi được refresh token —
// phiên vẫn sống thêm 7 ngày dù người dùng đã bấm "Đăng xuất" (kể từ khi FE tự gia hạn, cookie còn lại đó
// sẽ đăng nhập lại ngầm). Gia hạn trước rồi mới thử lại logout thì BE thu hồi và xoá cookie đúng như mong đợi.
const NO_AUTO_REFRESH_PATHS: ReadonlySet<string> = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

function canAutoRefresh(path: string): boolean {
  // Gia hạn cần cookie của trình duyệt và ghi lại cookie mới — render phía server không có cả hai.
  if (typeof window === 'undefined') return false;
  // `path` luôn bắt đầu bằng '/', có thể kèm query (`/auth/me?x=1`) — chỉ so phần đường dẫn.
  return !NO_AUTO_REFRESH_PATHS.has(path.split('?')[0]);
}

function sendRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

// Gọi thẳng `fetch` (không qua apiFetch) để không tự kích hoạt lại chính cơ chế gia hạn. Mọi lỗi mạng/5xx
// là "chưa rõ", chỉ 401/403 mới là BE chủ động từ chối phiên.
async function callRefreshEndpoint(): Promise<RefreshOutcome> {
  try {
    const res = await sendRequest('/auth/refresh', { method: 'POST' });
    if (res.ok) return 'refreshed';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// Gia hạn phiên dùng chung cho mọi nơi cần (apiFetch khi gặp 401; sau này kết nối real-time khi token hết hạn).
export function refreshSessionNow(): Promise<RefreshOutcome> {
  return refreshSession(callRefreshEndpoint);
}

// Wrapper fetch dùng chung cho mọi module — luôn gửi kèm cookie (credentials:
// "include") để httpOnly cookie (access_token/refresh_token, xem AuthController
// bên apps/api) tự động đính kèm, và luôn bóc theo envelope { success, data,
// message } đúng rules/backend.md mục 3.
//
// 2 lỗi client tự sinh (không từ BE, Week7.md 1.16): mất mạng (fetch() ném
// TypeError, không có response thật) và phản hồi không phải JSON hợp lệ (vd
// 502 từ proxy/gateway) — cả 2 đều mang nghĩa "chưa rõ kết quả", khác lỗi
// nghiệp vụ (kết quả chắc chắn). `status: 0` đánh dấu riêng trường hợp mất
// mạng vì không có status HTTP thật để dùng.
//
// 401 ở đường dẫn cần đăng nhập (Week10.md 2.1): access token (15 phút) đã hết hạn nhưng refresh token
// (7 ngày) có thể còn sống ⇒ gia hạn MỘT lần dùng chung rồi thử lại đúng MỘT lần. Gia hạn bị từ chối thì
// phiên đã mất: handler "mất phiên" được gọi và người gọi nhận lại đúng lỗi 401 gốc, không thử lại thêm.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await sendRequest(path, init);
    if (res.status === 401 && canAutoRefresh(path)) {
      const outcome = await refreshSessionNow();
      if (outcome === 'refreshed' || outcome === 'skipped') {
        res = await sendRequest(path, init);
      }
    }
  } catch {
    throw new ApiError('Network error', 0, 'NETWORK_ERROR');
  }

  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError('Invalid response', res.status, 'INVALID_RESPONSE');
  }

  if (!res.ok || !body.success) {
    throw new ApiError(
      body.message ?? 'Đã có lỗi xảy ra, vui lòng thử lại sau',
      res.status,
      body.code,
      body.details,
    );
  }

  return body.data;
}
