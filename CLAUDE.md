# Project Instructions — E-commerce Multi-Vendor

Đây là **sàn thương mại điện tử đa gian hàng (multi-vendor marketplace) đa ngành hàng** (không giới hạn 1 lĩnh vực cụ thể — có thể là thời trang, điện tử, gia dụng, mỹ phẩm...), xây dựng bằng Next.js + TypeScript (FE) và NestJS + PostgreSQL/Prisma (BE). Nền tảng cho phép nhiều shop độc lập cùng đăng ký bán hàng trên cùng một sàn, mỗi shop tự quản lý sản phẩm, biến thể, tồn kho và đơn hàng của riêng mình.

**Phạm vi nghiệp vụ:**

- Nền tảng cho phép nhiều shop (vendor) thuộc nhiều ngành hàng khác nhau cùng bán hàng, có vai trò Guest / User / Seller / Admin
- Sản phẩm có biến thể dạng ma trận đầy đủ theo thuộc tính linh hoạt (vd size × màu cho thời trang, dung lượng × màu cho điện tử...), mỗi combo quản lý tồn kho riêng — thuộc tính biến thể không cố định cứng theo 1 ngành hàng
- Danh mục (category) phân cấp để chứa được nhiều ngành hàng khác nhau
- Giỏ hàng có thể chứa sản phẩm từ nhiều shop/nhiều ngành hàng, khi checkout tách thành nhiều đơn theo từng shop
- Tính năng: guest checkout, voucher/mã giảm giá, wishlist, đa ngôn ngữ (vi-en), gợi ý sản phẩm liên quan, hủy đơn/hoàn tiền, chat real-time giữa buyer-seller
- Trang quản trị riêng cho Seller (quản lý shop, sản phẩm, đơn hàng) và Admin (quản lý toàn sàn, duyệt shop, thống kê)

**Mục tiêu kỹ thuật:** code sạch, có kiến trúc rõ ràng theo module, có test cho logic nghiệp vụ cốt lõi, deploy được thực tế (không chỉ chạy local) — để có thể trình bày và trả lời sâu khi phỏng vấn, không chỉ là project CRUD đơn giản.

## Tài liệu bắt buộc đọc trước khi code

@./rules/general.md
@./rules/frontend.md
@./rules/backend.md
@./docs/roadmap-ecommerce-multivendor.md

## Nguyên tắc làm việc

- Luôn đọc `rules/general.md` trước, sau đó đọc `rules/frontend.md` nếu code phần FE (`apps/web`) hoặc `rules/backend.md` nếu code phần BE (`apps/api`), cùng với `roadmap-ecommerce-multivendor.md` để biết đang ở phase nào.
- Tuân thủ nghiêm cấu trúc thư mục module theo phase, quy tắc đặt tên, git convention, code style, API convention và Definition of Done đã nêu trong `rules/`.
- Khi tạo 1 module FE/BE mới, dùng skill tương ứng thay vì tự bịa cấu trúc: `skills/scaffold-frontend-module/SKILL.md` hoặc `skills/scaffold-backend-module/SKILL.md`.
- Trước khi bắt đầu 1 phase/module mới: xác nhận lại phạm vi công việc theo đúng phase tương ứng trong roadmap, không code vượt phạm vi phase hiện tại trừ khi được yêu cầu.
- Không tự ý đổi tech stack đã chốt (xem bảng tech stack trong roadmap) nếu không có xác nhận.
- Khi hoàn thành 1 module, tự kiểm tra theo checklist "Definition of Done" trong `rules/general.md` trước khi báo hoàn thành.
- Nếu phát sinh quyết định kỹ trọng ảnh hưởng kiến trúc (đổi schema, đổi thư viện, đổi convention), hỏi lại trước khi thực hiện thay vì tự quyết.
- Mọi thay đổi liên quan tới lệnh hệ thống nguy hiểm (xóa dữ liệu, force push, reset DB...) đã bị chặn ở `.claude/settings.json` — không cố gắng bypass.
- **Không tự ý `git commit`** sau khi code xong, kể cả khi đang làm trên 1 nhánh feature đã tạo từ trước hoặc đã commit nhiều lần trước đó trong cùng phiên làm việc. Luôn để người dùng tự review code trước, chỉ commit khi được yêu cầu rõ ràng ở lượt trao đổi đó (không suy ra từ pattern các lượt trước).

## Ghi chú

- File permission (allow/deny lệnh bash) nằm ở `.claude/settings.json`, không sửa file này trừ khi cần bổ sung lệnh mới cho phase tiếp theo.
- Cấu trúc thư mục chi tiết (modules theo domain) xem phần "1. Cấu trúc module theo Phase" trong `rules/general.md`.
