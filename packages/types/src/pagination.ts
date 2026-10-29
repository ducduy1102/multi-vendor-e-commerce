// Trần số trang của các danh sách phân trang theo offset (`?page=`). Không có trần thì `page=1e21` VẪN qua
// `z.coerce.number().int().positive()` (1e21 là "số nguyên" của JS) rồi `OFFSET`/`skip` tràn số nguyên 64-bit: Postgres báo
// `bigint out of range` hoặc Prisma báo `Unable to fit value 2e+22 into a 64-bit signed integer` ⇒ 500 thay vì 400 (đã đo trên
// Postgres thật). Cùng tinh thần `PRODUCT_LIST_MAX_PAGE` (product.ts): 10.000 trang × tối đa 50 dòng = 500.000 dòng, rộng hơn
// mọi nhu cầu thật của các danh sách này (muốn tìm sâu hơn thì dùng bộ lọc / từ khoá). Danh sách người dùng của Admin có trần
// riêng lớn hơn (`ADMIN_USER_LIST_MAX_PAGE`) vì bảng users là bảng lớn nhất của sàn.
export const LIST_MAX_PAGE = 10_000;
