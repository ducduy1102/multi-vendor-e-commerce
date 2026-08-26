# General Rules (áp dụng cho cả FE & BE)

## 1. Cấu trúc module theo Phase

Mỗi domain nghiệp vụ (map theo Phase trong roadmap) là **1 module độc lập**, phát triển song song mà ít đụng chạm code nhau.

```
apps/
  web/                    # Next.js frontend — xem rules/frontend.md
  api/                    # NestJS backend — xem rules/backend.md
packages/
  types/                  # type/schema dùng chung FE-BE (Zod schema, DTO type)
```

Module theo domain (áp dụng cả 2 phía FE & BE, tên thư mục giống nhau để dễ đối chiếu):
`auth`, `shop`, `product`, `cart`, `checkout`, `voucher`, `order`, `review`, `chat`, `admin`

**Nguyên tắc:**
- Mỗi module tự chứa code riêng của nó. Không import chéo trực tiếp giữa 2 module nghiệp vụ — muốn lấy dữ liệu module khác thì gọi qua API (BE) hoặc qua `packages/types` (FE).
- Code dùng chung ≥ 2 module mới đưa vào `shared/`.
- Module chưa làm tới vẫn tạo sẵn cấu trúc thư mục con rỗng — dùng skill `scaffold-frontend-module` / `scaffold-backend-module` để tạo tự động, tránh mỗi module lại bịa cấu trúc khác nhau.

## 2. Quy tắc đặt tên

| Loại | Convention | Ví dụ |
|---|---|---|
| Database table | snake_case, số nhiều | `order_items` |
| Prisma model | PascalCase, số ít | `OrderItem` |
| API route (REST) | kebab-case, số nhiều | `/api/product-variants` |
| Biến boolean | tiền tố `is/has/should` | `isLoading`, `hasStock` |

Quy tắc riêng cho từng phía: xem `rules/frontend.md` và `rules/backend.md`.

## 3. Git convention

**Branch:** `feature/<module>-<mo-ta-ngan>`, `fix/<module>-<mo-ta-ngan>`, `chore/<mo-ta-ngan>`

**Commit (Conventional Commits):**
```
<type>(<module>): <mô tả ngắn gọn>

feat(product): thêm CRUD product variant theo size/màu
fix(cart): sửa lỗi trừ tồn kho sai khi 2 request đồng thời
```
Type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`.

Mỗi commit chỉ làm 1 việc, không gộp nhiều module trong 1 commit.

## 4. TypeScript & validate

- TypeScript strict mode bật từ đầu (`strict: true`), không dùng `any` nếu không comment giải thích lý do.
- Mọi input từ bên ngoài (form, API request, query param, response từ API khác, ENV) **phải validate bằng Zod** trước khi dùng.
- Type/schema dùng chung giữa FE-BE (vd Product, Order) định nghĩa 1 lần trong `packages/types`, không định nghĩa lại 2 nơi.

## 5. Testing chung

- FE dùng Vitest, BE dùng Jest (mặc định đi kèm Nest CLI — giữ nguyên để tận dụng tooling/tài liệu chuẩn của NestJS thay vì tự thay thế).
- Mỗi module bắt buộc có test cho **logic nghiệp vụ cốt lõi** trước khi coi là "xong" (tính tiền, áp voucher, trừ tồn kho...).
- Test file đặt cạnh file gốc: FE `cart.service.ts` → `cart.service.test.ts`; BE `cart.service.ts` → `cart.service.spec.ts` (đúng convention Jest/Nest).

## 6. Definition of Done (mỗi module/phase)

- [ ] Code pass lint + type-check
- [ ] Có test cho logic chính, test pass
- [ ] Đã test tay luồng chính (nếu có UI)
- [ ] Đã cập nhật API docs nếu thêm endpoint mới
- [ ] Commit theo convention, không còn code debug (`console.log`, comment thừa)
