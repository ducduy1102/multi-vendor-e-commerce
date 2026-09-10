const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Wrapper fetch dùng chung cho mọi module — luôn gửi kèm cookie (credentials:
// "include") để httpOnly cookie (access_token/refresh_token, xem AuthController
// bên apps/api) tự động đính kèm, và luôn bóc theo envelope { success, data,
// message } đúng rules/backend.md mục 3.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || !body.success) {
    throw new ApiError(
      body.message ?? "Đã có lỗi xảy ra, vui lòng thử lại sau",
      res.status,
    );
  }

  return body.data;
}
