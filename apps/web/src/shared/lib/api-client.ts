// Export để dùng cho những chỗ điều hướng thẳng trình duyệt (không qua
// apiFetch) — vd GoogleLoginButton trỏ <a href> thẳng tới BE.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000";

// BE version từ endpoint đầu tiên (Tuần 3 Bước 1.5, app.setGlobalPrefix('api/v1')
// ở apps/api/src/main.ts) — khai 1 chỗ duy nhất, cả apiFetch lẫn chỗ điều
// hướng thẳng trình duyệt (GoogleLoginButton) đều phải tự nối thêm.
export const API_PREFIX = "/api/v1";

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
    this.name = "ApiError";
  }
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
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Network error", 0, "NETWORK_ERROR");
  }

  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError("Invalid response", res.status, "INVALID_RESPONSE");
  }

  if (!res.ok || !body.success) {
    throw new ApiError(
      body.message ?? "Đã có lỗi xảy ra, vui lòng thử lại sau",
      res.status,
      body.code,
      body.details,
    );
  }

  return body.data;
}
