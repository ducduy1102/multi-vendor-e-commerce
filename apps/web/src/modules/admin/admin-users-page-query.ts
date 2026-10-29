import { adminUserListQuerySchema } from '@ecommerce/types';

import type { AccountStatus, UserRole } from './types';

export interface AdminUsersPageQuery {
  // undefined = không lọc (tab "Tất cả" / mọi vai / không tìm).
  status?: AccountStatus;
  role?: UserRole;
  q?: string;
  page: number;
  // Người dùng đang mở ở ngăn chi tiết (`?u=<id>`); undefined = ngăn đóng.
  userId?: string;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Id người dùng là UUID (giống kiểm tra `isUserId` ở BE): id sai dạng không bao giờ được đưa vào URL gọi API.
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

// Param lặp (?status=a&status=b) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?status=&role=&q=&page=&u=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: từng
// param sai dạng rơi về "không lọc" ĐỘC LẬP (status lạ không làm mất từ khoá đang tìm, và ngược lại), không bao giờ
// ném lỗi làm sập trang. Dùng lại chính schema BE (enum, độ dài/ký tự của từ khoá, page coerce) để hai phía không lệch luật.
export function parseAdminUsersPageQuery(raw: RawSearchParams): AdminUsersPageQuery {
  const { shape } = adminUserListQuerySchema;
  const status = shape.status.safeParse(firstValue(raw.status));
  const role = shape.role.safeParse(firstValue(raw.role));
  const q = shape.q.safeParse(firstValue(raw.q));
  const page = shape.page.safeParse(firstValue(raw.page));
  const userId = firstValue(raw.u);

  return {
    status: status.success ? status.data : undefined,
    role: role.success ? role.data : undefined,
    q: q.success ? q.data : undefined,
    page: page.success ? page.data : 1,
    userId: userId !== undefined && isUserId(userId) ? userId : undefined,
  };
}
