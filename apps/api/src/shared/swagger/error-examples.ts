import type { ServerErrorCode } from '@ecommerce/types';

// Body lỗi mẫu cho `@ApiResponse({ schema: { example } })` — đúng hình dạng AllExceptionsFilter trả ra
// (`{ success: false, data: null, message, code?, details? }`). Lỗi chưa có mã máy đọc được (401/403
// của guard, validate Zod, một số 404 cũ) thì bỏ `code`. Chỉ phục vụ tài liệu Swagger, không dùng trong
// logic.
export function errorExample(
  message: string,
  extra: { code?: ServerErrorCode; details?: Record<string, unknown> } = {},
) {
  return { success: false, data: null, message, ...extra };
}

export const UNAUTHORIZED_EXAMPLE = errorExample('Unauthorized');

// RolesGuard từ chối (thiếu role) — khác 403 của ShopOwnerGuard ("Not the shop owner").
export const FORBIDDEN_ROLE_EXAMPLE = errorExample('Forbidden resource');
