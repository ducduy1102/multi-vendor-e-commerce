import { Prisma } from '@prisma/client';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';

// Tìm kiếm người dùng của Admin (Week11.md 3.2) cần "không phân biệt hoa-thường VÀ dấu" (gõ `nguyen` ra `Nguyễn`, gõ `dung`
// ra `Đũng`), thứ Prisma `contains` + `mode: 'insensitive'` không làm được (ILIKE chỉ bỏ qua hoa-thường). Dùng `unaccent`
// (extension đã bật từ tìm kiếm sản phẩm) nên điều kiện tìm là SQL thuần. Mọi giá trị người dùng nhập đi vào CÂU LỆNH dưới
// dạng THAM SỐ ràng buộc (`Prisma.sql`), không bao giờ nối vào chuỗi SQL.

// Ký tự đặc biệt của LIKE là `\` (thoát), `%` và `_`: người dùng gõ `100%` hay `a_b` là muốn tìm đúng ký tự đó chứ không
// phải mẫu khớp mọi thứ — không thoát thì `_` khớp một ký tự bất kỳ và `%` khớp cả bảng. Thoát bằng dấu `\` (mặc định của
// LIKE nên không cần mệnh đề ESCAPE).
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// Mẫu "chứa": bỏ khoảng trắng đã làm ở schema. Rỗng không bao giờ tới đây (schema đổi chuỗi rỗng thành undefined).
export function userSearchPattern(q: string): string {
  return `%${escapeLikePattern(q)}%`;
}

// Mệnh đề WHERE (hoặc rỗng) dùng chung cho câu lấy trang và câu đếm tổng, để hai câu không thể lệch nhau. `role` và
// `account_status` là enum Postgres nên giá trị ràng buộc phải ép kiểu tường minh.
export function buildAdminUserWhere(
  query: Pick<ListUsersQueryDto, 'q' | 'role' | 'status'>,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (query.q !== undefined) {
    const pattern = userSearchPattern(query.q);
    conditions.push(
      Prisma.sql`(unaccent(email) ILIKE unaccent(${pattern}::text) OR unaccent(name) ILIKE unaccent(${pattern}::text))`,
    );
  }
  if (query.role !== undefined) {
    conditions.push(Prisma.sql`role = ${query.role}::"Role"`);
  }
  if (query.status !== undefined) {
    conditions.push(
      Prisma.sql`account_status = ${query.status}::"AccountStatus"`,
    );
  }

  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}
