# Roadmap Pet Project: E-commerce Multi-Vendor

**Mục tiêu:** Đây là **sàn thương mại điện tử đa gian hàng (multi-vendor marketplace) đa ngành hàng** (không giới hạn 1 lĩnh vực cụ thể — có thể là thời trang, điện tử, gia dụng, mỹ phẩm...), xây dựng bằng Next.js + TypeScript (FE) và NestJS + PostgreSQL/Prisma (BE). Nền tảng cho phép nhiều shop độc lập cùng đăng ký bán hàng trên cùng một sàn, mỗi shop tự quản lý sản phẩm, biến thể, tồn kho và đơn hàng của riêng mình.

**Đặc điểm project:**

- Multi-vendor (nhiều shop bán trên cùng platform)
- Biến thể sản phẩm dạng ma trận đầy đủ (size × màu, tồn kho riêng từng combo)
- Tính năng: Guest checkout, Voucher/mã giảm giá, Wishlist, Đa ngôn ngữ (vi-en), Gợi ý sản phẩm liên quan, Hủy đơn/hoàn tiền, Chat buyer-seller

**Tổng thời gian ước tính:** 12-14 tuần (part-time)

**Tech stack đề xuất:**

- Frontend: Next.js (App Router) + TypeScript, TailwindCSS, Shadcn/ui, Zustand/React Query, React Hook Form + Zod
- Backend: NestJS, PostgreSQL + Prisma ORM
- Auth: JWT + refresh token
- Thanh toán: VNPay/Momo sandbox
- Real-time: Socket.io / Pusher / Ably
- Ảnh: Cloudinary
- Deploy: Vercel (FE), Railway/Render/VPS (BE), Docker
- CI/CD: GitHub Actions
- Test: Vitest + React Testing Library
- i18n: next-intl

---

## Phase 0 — Kiến trúc & Setup (Tuần 1-2)

### Tuần 1

- Quyết định kiến trúc: monorepo (Turborepo) hay tách repo FE/BE riêng — khuyến nghị monorepo để share types giữa FE/BE
- Setup Next.js + TypeScript, Tailwind, Shadcn/ui, ESLint, Prettier, Husky (pre-commit lint)
- Setup backend: NestJS (module hóa rõ ràng, dễ maintain khi nhiều domain: shop, product, order, payment...)
- PostgreSQL + Prisma, Docker Compose cho DB local

### Tuần 2

- Thiết kế kiến trúc tổng thể: sơ đồ các domain (User, Shop, Product, Order, Payment, Chat) và mối quan hệ
- Auth: đăng ký/đăng nhập, JWT + refresh token, phân quyền Guest/User/Seller/Admin
- Setup i18n (next-intl hoặc next-i18next) ngay từ đầu

---

## Phase 1 — Vendor & Catalog (Tuần 3-5)

### Tuần 3

- Luồng đăng ký trở thành Seller (onboarding: thông tin shop, xác minh cơ bản)
- Trang quản lý Shop cho Seller (thông tin, logo, banner)
- Thiết kế schema Product với variant matrix (Product → ProductVariant với attribute size/color → tồn kho riêng từng variant)

### Tuần 4

- CRUD sản phẩm cho Seller (tạo sản phẩm kèm nhiều variant cùng lúc)
- Upload ảnh theo từng variant (Cloudinary)
- Trang danh sách sản phẩm public: filter theo shop, category, giá, size, màu; sort; pagination

### Tuần 5

- Trang chi tiết sản phẩm: chọn variant (size/màu) → cập nhật ảnh, giá, tồn kho tương ứng
- Search sản phẩm (Postgres full-text search hoặc Algolia/Meilisearch)
- Wishlist (yêu thích sản phẩm)

---

## Phase 2 — Giỏ hàng, Checkout & Voucher (Tuần 6-7)

### Tuần 6

- Giỏ hàng multi-vendor (1 giỏ hàng chứa sản phẩm từ nhiều shop → khi checkout tách thành nhiều Order theo từng shop)
- Guest checkout (cart lưu localStorage cho guest, merge vào DB khi đăng nhập)
- Voucher/mã giảm giá: theo shop hoặc toàn sàn, theo % hoặc số tiền, giới hạn lượt dùng

### Tuần 7

- Tích hợp thanh toán (VNPay/Momo sandbox), xử lý webhook
- Logic trừ tồn kho theo variant khi đặt hàng thành công, xử lý race condition
- Tính phí vận chuyển (có thể giả lập theo khu vực)

---

## Phase 3 — Đơn hàng, Đánh giá & Hoàn tiền (Tuần 8-9)

### Tuần 8

- Trang "Đơn hàng của tôi", tracking trạng thái theo từng shop
- Trang quản lý đơn hàng cho Seller (xác nhận, đóng gói, giao hàng)
- Review/rating sản phẩm (chỉ user đã mua)

### Tuần 9

- Luồng hủy đơn/hoàn tiền: user yêu cầu → seller/admin duyệt → xử lý hoàn tiền
- Gợi ý sản phẩm liên quan (theo category/shop, nâng cao hơn thì collaborative filtering cơ bản)

---

## Phase 4 — Chat & Admin (Tuần 10-11)

### Tuần 10

- Chat real-time buyer-seller (Socket.io/Pusher/Ably) — lưu lịch sử tin nhắn, thông báo tin nhắn mới
- Notification hệ thống (đơn hàng mới, tin nhắn mới) — bell icon + real-time update

### Tuần 11

- Trang Admin tổng: quản lý tất cả shop, duyệt shop mới, xử lý report/khiếu nại
- Dashboard thống kê toàn sàn (doanh thu, đơn hàng, top shop) bằng chart
- Quản lý hoa hồng (commission) nếu muốn mô phỏng mô hình thật

---

## Phase 5 — Chất lượng, Bảo mật & Test (Tuần 12)

- Unit test cho logic quan trọng (tính tiền, trừ tồn kho, voucher, phân quyền)
- Rate limiting, validate input kỹ, chống race condition khi đặt hàng
- Error handling toàn diện, loading/skeleton/empty state
- Kiểm tra Lighthouse, tối ưu ảnh, lazy load, caching (React Query)

---

## Phase 6 — Deploy & Hoàn thiện hồ sơ (Tuần 13-14)

- Docker hóa toàn bộ (dễ demo, dễ nói về DevOps trong phỏng vấn)
- Deploy FE (Vercel) + BE (Railway/Render/VPS), setup CI/CD (GitHub Actions: lint, test, build tự động)
- README chuẩn: kiến trúc hệ thống, ERD, API docs (Swagger), hướng dẫn chạy local, link demo
- Video demo 3-5 phút, deck 1 trang giới thiệu project để gắn portfolio

---

## Lưu ý quan trọng

Với scope lớn thế này, nên **build MVP trước** (Phase 0-2, tuần 1-7) và deploy sớm để có bản chạy được, rồi tiếp tục mở rộng Phase 3-6 song song với việc apply — tránh tình trạng "chưa xong nên chưa dám nộp CV".

## Bước tiếp theo

- [ ] Thiết kế DB schema chi tiết (ERD) cho toàn bộ hệ thống
- [ ] Thiết kế cấu trúc folder/module cho FE và BE
- [ ] Xác định danh sách API endpoints cần cho MVP
