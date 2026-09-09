---
name: scaffold-frontend-module
description: Sử dụng skill này khi cần tạo mới 1 module frontend (domain) trong apps/web/src/modules/, ví dụ khi bắt đầu 1 phase mới trong roadmap (product, cart, checkout, order, review, chat, admin...). Tự động tạo đúng cấu trúc thư mục và file mẫu theo rules/frontend.md, tránh mỗi module có cấu trúc khác nhau.
---

# Scaffold Frontend Module

## Khi nào dùng
Khi bắt đầu code 1 domain/module FE mới chưa tồn tại trong `apps/web/src/modules/`.

## Các bước thực hiện

1. Đọc `rules/general.md` và `rules/frontend.md` để nắm convention hiện tại (có thể đã cập nhật).
2. Xác nhận tên module (snake-case/camelCase theo tên domain, vd `product`, `cart`, `checkout`).
3. Tạo cấu trúc thư mục:
```
modules/<domain>/
  components/
  hooks/
  services/
  schemas/
  types.ts
  __tests__/
  index.ts          # barrel export những gì module này expose ra ngoài
```
4. Tạo file mẫu tối thiểu:
   - `services/<domain>.service.ts`: các hàm gọi API (dùng fetch wrapper từ `shared/lib/api-client`), KHÔNG chứa logic UI.
   - `schemas/<domain>.schema.ts`: Zod schema cho form/response chính của module.
   - `types.ts`: type suy ra từ Zod schema bằng `z.infer`.
   - `hooks/use<Domain>.ts`: hook TanStack Query wrap service (nếu module cần fetch data).
   - `index.ts`: export những component/hook cần dùng ở `app/` — không export toàn bộ nội bộ module.
5. KHÔNG import trực tiếp nội bộ của module khác — nếu cần dữ liệu module khác, gọi qua service/API riêng.
6. Sau khi scaffold xong, xác nhận lại với người dùng phạm vi tính năng cụ thể của module (đối chiếu roadmap) trước khi code chi tiết bên trong.

## Lưu ý
- Không tự tạo page.tsx trong `app/` khi scaffold — việc đó làm riêng, chỉ setup phần `modules/`.
- Nếu module cần state chia sẻ nhiều route (vd cart), thêm `store/<domain>.store.ts` (Zustand) thay vì để trong hooks.
