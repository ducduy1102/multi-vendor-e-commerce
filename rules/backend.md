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
      <domain>.service.spec.ts   # cạnh file gốc, không để trong __tests__/ riêng (rules/general.md mục 5)
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
- Side-effect gọi service ngoài (gửi mail, gọi API bên thứ 3...) **sau khi** 1 thao tác ghi DB đã thành công không được phép làm fail cả request — bọc try/catch + log lỗi (`Logger.error`), không rethrow. DB đã "xong việc" của nó; side-effect lỗi chỉ nên ảnh hưởng tới chính side-effect đó (vd cho phép bấm "gửi lại" sau), không rollback ngược lại phần đã ghi thành công.

## 5. Auth & phân quyền

- JWT access token (thời hạn ngắn) + refresh token (thời hạn dài, lưu hashed trong DB hoặc httpOnly cookie).
- `RolesGuard` kiểm tra role (Guest/User/Seller/Admin) ở decorator `@Roles()` trên từng endpoint, không check role thủ công trong logic service.
- Seller chỉ được thao tác trên dữ liệu thuộc shop của chính mình — kiểm tra `shopId` khớp `req.user` ở service layer, không tin tưởng `shopId` gửi từ client.
- **Hash secret entropy cao (refresh token, token verify email...) bằng SHA-256 + `timingSafeEqual`, KHÔNG dùng `bcrypt`** — bcrypt chỉ đọc 72 byte đầu input, nhiều secret có cùng phần đầu (vd cùng payload JWT header+sub+role) sẽ bị báo khớp nhầm dù phần đuôi khác nhau, cho phép dùng lại token cũ đã bị thu hồi/rotate. `bcrypt` chỉ dùng cho password do người dùng chọn (entropy thấp, cần salt + cost factor chống brute-force, không có vấn đề độ dài).
- Nếu cần trạng thái tài khoản (khoá/mở) có hiệu lực ngay lập tức thay vì chờ access token hết hạn, check lại trong `Strategy.validate()` (query DB theo `payload.sub` mỗi request), không chỉ decode payload — đánh đổi 1 phần lợi ích stateless của JWT, chấp nhận được ở quy mô project vừa/nhỏ (query theo `id` có index).

## 6. Module đặc thù cần lưu ý

- **product**: CRUD product phải xử lý đồng thời nhiều variant trong 1 request (transaction), không tạo variant qua nhiều request rời rạc.
- **cart/checkout**: khi checkout, tách order theo từng shop trong cùng 1 transaction — hoặc tất cả thành công, hoặc rollback toàn bộ.
- **chat**: dùng Gateway riêng (Socket.io) tách khỏi REST controller, có guard xác thực kết nối socket.

## 7. Testing BE

- Dùng Jest (mặc định Nest CLI đã scaffold sẵn — `apps/api/package.json` có config Jest riêng), không đổi sang Vitest. Test file đặt cạnh file gốc, hậu tố `.spec.ts` (vd `cart.service.spec.ts`), đúng convention Nest thay vì `.test.ts` như FE.
- Unit test cho service (đặc biệt: tính tiền, áp voucher, trừ tồn kho, phân quyền theo shop).
- Test riêng case race condition trừ tồn kho nếu có thể (giả lập 2 request đồng thời).
- Không bắt buộc e2e test toàn bộ, ưu tiên e2e cho luồng checkout (luồng quan trọng nhất).

## 8. Provider & dependency — tránh sập app lúc bootstrap

- NestJS khởi tạo (instantiate) **toàn bộ** provider khai trong `providers: []` của mọi Module được `import` vào `AppModule` ngay lúc app boot — bất kể provider đó có được gọi tới hay không trong request đầu tiên. Field initializer/constructor của 1 `@Injectable()` vì vậy **phải rẻ và không thể throw**: bất cứ thứ gì có thể fail vì thiếu cấu hình (thiếu API key, service ngoài down...) — vd `new ResendClient(apiKey)`, kết nối DB thủ công ngoài Prisma — phải trì hoãn vào 1 method riêng gọi lúc thực sự dùng (lazy init qua getter), không phải chạy ngay trong constructor.
- Một số thư viện (đặc biệt Passport `Strategy`, vd `passport-google-oauth20`) **không cho lazy-init** — bản thân `super(options)` bắt buộc gọi ngay trong constructor với đủ field, throw ngay nếu thiếu. Với trường hợp này, dùng giá trị fallback giả (vd `'not-configured'`) khi thiếu ENV thay vì để constructor throw — chấp nhận việc gọi endpoint liên quan sẽ lỗi rõ ràng lúc đó, đổi lại app vẫn bootstrap được bình thường cho mọi route khác.
- Khi thêm 1 package chính thức trong hệ sinh thái `@nestjs/*` (jwt, passport, swagger...), kiểm tra version mới nhất có phải ESM-only (`"type": "module"`) không tương thích build CommonJS mặc định của NestJS trước khi cài — nếu gặp lỗi `ERR_REQUIRE_ESM` lúc chạy thật (không lộ ra lúc `nest build` vì đó chỉ type-check), pin về version major ngay trước đó (thường vẫn còn hỗ trợ CJS).

## 9. Tài liệu tham khảo

- [brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate) — boilerplate NestJS được maintain tốt (~4.3k sao), có sẵn Auth (JWT + refresh token), I18N, Docker, cấu trúc module rõ ràng, khớp với mục 1 và mục 5. Mặc định dùng TypeORM chứ không phải Prisma — kiểm tra branch/fork phù hợp trước khi lấy làm nền, hoặc chỉ tham khảo cấu trúc module/auth flow.
- [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure) — platform e-commerce mã nguồn mở build bằng NestJS, có sẵn tính năng multi-vendor marketplace thật ([doc](https://docs.vendure.io/current/core/how-to/multi-vendor-marketplaces)). Đáng đọc để học cách model domain Shop/Seller và tách Order theo vendor khi checkout (mục 6 — module `cart/checkout`). Dùng GraphQL + hệ plugin riêng, không dùng Prisma — chỉ đọc tham khảo domain logic, không lấy làm boilerplate để clone.
