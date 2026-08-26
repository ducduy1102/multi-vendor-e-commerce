# Backend Rules (NestJS + PostgreSQL + Prisma)

Áp dụng cho toàn bộ `apps/api`. Đọc cùng `rules/general.md`.

## 1. Cấu trúc thư mục module

```
apps/api/src/
  modules/
    <domain>/              # vd: product, cart, order...
      <domain>.controller.ts
      <domain>.service.ts
      <domain>.module.ts
      dto/
        create-<domain>.dto.ts
        update-<domain>.dto.ts
      __tests__/
  shared/
    guards/                # AuthGuard, RolesGuard...
    interceptors/          # response transform, logging
    pipes/                  # validation pipe dùng chung
    decorators/             # @CurrentUser(), @Roles()...
    filters/                 # exception filter chuẩn hóa response lỗi
  prisma/
    schema.prisma
    migrations/
```

**Quy tắc:** Controller chỉ nhận request, gọi service, trả response — không viết logic nghiệp vụ trong controller.

## 2. DTO & Validate

- Mọi request body/query validate bằng `class-validator` + `ValidationPipe` global, hoặc Zod nếu đồng bộ schema với FE qua `packages/types` (ưu tiên Zod để tái dùng schema 2 phía).
- DTO tách riêng `create` và `update` (update thường có field optional).

## 3. API response convention

```json
{
  "success": true,
  "data": { },
  "message": "optional"
}
```
- Lỗi dùng exception filter chuẩn (`shared/filters`) để mọi lỗi trả về cùng format, đúng status code (400/401/403/404/409/500).
- `409 Conflict` dùng riêng cho trường hợp tranh chấp tồn kho (2 người mua cùng lúc hết hàng).

## 4. Prisma & database

- Thao tác ghi/sửa liên quan **order, payment, stock** bắt buộc bọc trong `prisma.$transaction` để đảm bảo toàn vẹn dữ liệu.
- Trừ tồn kho theo variant: dùng update có điều kiện (`WHERE stock >= quantity`) trong transaction để tránh oversell khi có race condition, không đọc-rồi-ghi (read-then-write) tách rời.
- Query chỉ `select` field cần dùng, tránh trả cả object lớn không cần thiết (đặc biệt list product/order).
- Migration đặt tên rõ nghĩa: `add_product_variant_table`, không để tên mặc định `migration_xxx`.

## 5. Auth & phân quyền

- JWT access token (thời hạn ngắn) + refresh token (thời hạn dài, lưu hashed trong DB hoặc httpOnly cookie).
- `RolesGuard` kiểm tra role (Guest/User/Seller/Admin) ở decorator `@Roles()` trên từng endpoint, không check role thủ công trong logic service.
- Seller chỉ được thao tác trên dữ liệu thuộc shop của chính mình — kiểm tra `shopId` khớp `req.user` ở service layer, không tin tưởng `shopId` gửi từ client.

## 6. Module đặc thù cần lưu ý

- **product**: CRUD product phải xử lý đồng thời nhiều variant trong 1 request (transaction), không tạo variant qua nhiều request rời rạc.
- **cart/checkout**: khi checkout, tách order theo từng shop trong cùng 1 transaction — hoặc tất cả thành công, hoặc rollback toàn bộ.
- **chat**: dùng Gateway riêng (Socket.io) tách khỏi REST controller, có guard xác thực kết nối socket.

## 7. Testing BE

- Dùng Jest (mặc định Nest CLI đã scaffold sẵn — `apps/api/package.json` có config Jest riêng), không đổi sang Vitest. Test file đặt cạnh file gốc, hậu tố `.spec.ts` (vd `cart.service.spec.ts`), đúng convention Nest thay vì `.test.ts` như FE.
- Unit test cho service (đặc biệt: tính tiền, áp voucher, trừ tồn kho, phân quyền theo shop).
- Test riêng case race condition trừ tồn kho nếu có thể (giả lập 2 request đồng thời).
- Không bắt buộc e2e test toàn bộ, ưu tiên e2e cho luồng checkout (luồng quan trọng nhất).

## 8. Tài liệu tham khảo

- [brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate) — boilerplate NestJS được maintain tốt (~4.3k sao), có sẵn Auth (JWT + refresh token), I18N, Docker, cấu trúc module rõ ràng, khớp với mục 1 và mục 5. Mặc định dùng TypeORM chứ không phải Prisma — kiểm tra branch/fork phù hợp trước khi lấy làm nền, hoặc chỉ tham khảo cấu trúc module/auth flow.
- [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure) — platform e-commerce mã nguồn mở build bằng NestJS, có sẵn tính năng multi-vendor marketplace thật ([doc](https://docs.vendure.io/current/core/how-to/multi-vendor-marketplaces)). Đáng đọc để học cách model domain Shop/Seller và tách Order theo vendor khi checkout (mục 6 — module `cart/checkout`). Dùng GraphQL + hệ plugin riêng, không dùng Prisma — chỉ đọc tham khảo domain logic, không lấy làm boilerplate để clone.
