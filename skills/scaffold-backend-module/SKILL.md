---
name: scaffold-backend-module
description: Sử dụng skill này khi cần tạo mới 1 module backend (domain) trong apps/api/src/modules/, ví dụ khi bắt đầu 1 phase mới trong roadmap (product, cart, checkout, order, review, voucher, chat, admin...). Tự động tạo đúng cấu trúc thư mục/file theo rules/backend.md, đồng thời áp dụng checklist RESTful API để tránh lỗi thiết kế endpoint phổ biến.
---

# Scaffold Backend Module

## Khi nào dùng
Khi bắt đầu code 1 domain/module BE mới chưa tồn tại trong `apps/api/src/modules/`, hoặc khi thêm endpoint mới vào module đã có (chạy qua checklist RESTful bên dưới trước khi viết controller).

## Các bước thực hiện

1. Đọc `rules/general.md` + `rules/backend.md` để nắm convention hiện tại (có thể đã cập nhật).
2. Xác nhận tên module (kebab-case số ít cho tên thư mục, vd `product`, `cart`, `checkout`) — không tự tạo module mới nếu đã nằm ngoài danh sách 10 module đã chốt (`auth, shop, product, cart, checkout, voucher, order, review, chat, admin`), phải xác nhận với người dùng trước.
3. Tạo cấu trúc thư mục:
```
modules/<domain>/
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.module.ts
  dto/
    create-<domain>.dto.ts
    update-<domain>.dto.ts
  <domain>.service.spec.ts   # cạnh file gốc, không để trong __tests__/ riêng
```
4. Controller chỉ nhận request, gọi service, trả response — **không** viết logic nghiệp vụ trong controller (đúng `rules/backend.md` mục 1).
5. Thiết kế route/method/status code theo **checklist RESTful API** bên dưới.
6. Đăng ký module vào `AppModule` (hoặc module cha phù hợp).
7. Sau khi scaffold xong, xác nhận lại phạm vi tính năng cụ thể của module (đối chiếu roadmap) trước khi code chi tiết business logic bên trong.

---

## Checklist RESTful API — áp dụng khi thiết kế mọi endpoint mới

**1. URL là danh từ số nhiều, kebab-case — không chứa verb.**
`/product-variants`, `/order-items` — không viết `/getProductVariants`, `/product/create`. Verb đã có sẵn qua HTTP method. Ngoại lệ chấp nhận được: action không map được vào CRUD 1 resource (checkout đa shop, huỷ đơn...) — dùng dạng `POST /checkout`, `POST /orders/:id/cancel`, không lạm dụng.

**2. HTTP method đúng ngữ nghĩa.**
GET (an toàn, idempotent, không side-effect, không body) · POST (tạo mới hoặc action không idempotent) · PATCH (update một phần — ưu tiên dùng thay vì PUT trừ khi thật sự thay thế toàn bộ resource) · DELETE (xoá — nhưng với resource có lịch sử giao dịch như Shop/Product/ProductVariant, "xoá" ở tầng service là update `status`/`isActive`, không phải `prisma.delete`, xem `note-db.md` mục 5).

**3. Status code đúng theo `rules/backend.md` mục 3** — không tự sáng tạo thêm status ngoài danh sách đã chốt:
`200` (GET/PATCH thành công) · `201` (POST tạo mới thành công) · `204` (DELETE thành công, không trả body) · `400` (validate lỗi — dùng chung cho mọi lỗi input, không tự thêm `422`) · `401` (chưa đăng nhập) · `403` (đã đăng nhập nhưng không đủ quyền, vd seller thao tác shop không phải của mình) · `404` (không tìm thấy resource) · `409` (conflict — race condition tồn kho, trùng dữ liệu unique).

**4. GET không được gây side-effect.** Không tăng lượt xem, không trừ kho, không ghi log nghiệp vụ trong handler GET — nếu cần track, tách qua action riêng (POST) hoặc xử lý async, không nhét vào GET.

**5. Nested resource tối đa 2 cấp**, sâu hơn thì tách endpoint phẳng + filter qua query param.
OK: `/shops/:shopId/products`. Tránh: `/shops/:id/products/:id/variants/:id/attribute-values/:id` — thay bằng `/product-variants/:id` kèm filter nếu cần.

**6. Pagination/filter/sort qua query param, không qua body của GET.**
`?page=1&limit=20&sort=-createdAt&categoryId=...`. Response luôn bọc theo response envelope đã chốt (`{ success, data, message }`), metadata phân trang (`page, limit, total`) nằm lồng trong `data`, không trả mảng trần.

**7. Versioning ngay từ endpoint đầu tiên** — prefix `/api/v1`, tránh phải đổi toàn bộ client khi có breaking change sau này. Nếu `apps/api/src/main.ts` chưa có `app.setGlobalPrefix('api/v1')`, hỏi lại người dùng trước khi thêm (ảnh hưởng mọi route hiện có).

**8. Không trả thẳng Prisma model ra response** — luôn qua DTO/serializer chọn field cần trả, tránh lộ field nhạy cảm (`passwordHash`, `refreshTokenHash`). Khớp `rules/backend.md` mục 4 "chỉ select field cần dùng".

**9. Không tin dữ liệu định danh quyền hạn từ client.** `shopId`, `userId`, `role` dùng để phân quyền phải lấy từ `@CurrentUser()` (JWT payload) hoặc đối chiếu DB ở service layer — không lấy trực tiếp từ request body/query dù client có gửi lên. Đúng `rules/backend.md` mục 5.

**10. Idempotency cho endpoint xử lý tiền/webhook.** Webhook VNPay/Momo (Tuần 7) có thể bị gọi lại nhiều lần cho cùng 1 giao dịch — check `transactionId` đã xử lý chưa trước khi update `Payment`/`Order`, không cộng dồn/trừ kho 2 lần.

**11. Không leak chi tiết lỗi hệ thống ra client.** Lỗi 500 trả message chung chung qua exception filter, log chi tiết (stack trace, query lỗi) ở server, không đưa vào response.

---

## Lưu ý

- Response luôn qua format chuẩn `{ success, data, message }` (interceptor dùng chung ở `shared/interceptors`), lỗi luôn qua exception filter chung ở `shared/filters` — không tự trả response khác format ngay trong 1 controller riêng lẻ.
- Test unit cho service (đặc biệt tính tiền, áp voucher, trừ tồn kho, phân quyền theo shop) là bắt buộc trước khi coi module "xong" — xem Definition of Done ở `rules/general.md` mục 6.
