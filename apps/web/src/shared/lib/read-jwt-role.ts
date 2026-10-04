import { z } from 'zod';

const jwtPayloadRoleSchema = z.object({ role: z.string() });

// Đọc `role` từ payload của access token (JWT) ở edge (proxy.ts, Week8.md 1.8) — GIẢI MÃ KHÔNG
// VERIFY CHỮ KÝ: edge không có JWT secret và cũng không nên có. Kết quả CHỈ được dùng để điều hướng
// cho đúng trải nghiệm (đẩy người không phải ADMIN ra khỏi /admin/*), TUYỆT ĐỐI không phải ranh giới
// bảo mật — cookie bị giả role ADMIN chỉ vào được khung trang, mọi API /admin/* vẫn bị RolesGuard ở
// BE trả 403 (rules/frontend.md mục 1: guard ở proxy chỉ check điều kiện đọc được trực tiếp từ cookie).
// Token thiếu/sai dạng/payload lạ đều trả null, không bao giờ ném lỗi làm sập proxy.
export function readJwtRole(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // base64url -> base64 chuẩn (atob không hiểu `-`/`_` và đòi đủ padding `=`).
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const parsed = jwtPayloadRoleSchema.safeParse(JSON.parse(atob(padded)));
    return parsed.success ? parsed.data.role : null;
  } catch {
    return null;
  }
}
