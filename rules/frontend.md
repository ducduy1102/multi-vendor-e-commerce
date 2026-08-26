# Frontend Rules (Next.js + TypeScript)

Áp dụng cho toàn bộ `apps/web`. Đọc cùng `rules/general.md`.

## 1. Cấu trúc thư mục module

```
apps/web/src/
  modules/
    <domain>/             # vd: product, cart, order...
      components/         # UI component chỉ dùng trong module này
      hooks/               # custom hook của module (useCart, useProductFilter...)
      services/            # gọi API, không chứa logic UI
      schemas/             # Zod schema validate form/response của module
      types.ts
      __tests__/
  shared/
    components/           # UI dùng chung (Button, Modal, Skeleton...)
    hooks/                 # hook dùng chung (useDebounce, useMediaQuery...)
    lib/                    # api client, constants, utils thuần
    types/
  app/                     # Next.js App Router — chỉ route + layout, KHÔNG chứa logic
```

**Quy tắc:** file trong `app/` (page.tsx, layout.tsx) chỉ compose component từ `modules/`, không viết logic nghiệp vụ trực tiếp ở đây.

## 2. Server Component vs Client Component

- Mặc định **Server Component**. Chỉ thêm `"use client"` khi thật sự cần: state, event handler, browser API, hoặc dùng hook client-only (Zustand, TanStack Query hook).
- Data fetch ban đầu (SSR) nên thực hiện ở Server Component gọi thẳng service/API, không dùng TanStack Query cho lần fetch đầu nếu không cần.
- Component tương tác nhiều (filter, cart, variant selector, chat) mới cần Client Component + TanStack Query/Zustand.

## 3. State management — khi nào dùng gì

| Loại state | Dùng |
|---|---|
| State chỉ 1 component (input, toggle) | `useState` |
| State chia sẻ nhiều component/route (cart, auth user, sidebar) | Zustand |
| Dữ liệu từ server (product list, order history) | TanStack Query |
| Dữ liệu form | React Hook Form (không đưa vào Zustand) |

Không đưa server data vào Zustand store — TanStack Query đã lo cache/refetch, tránh trùng lặp nguồn sự thật (source of truth).

## 4. Form & validate

- Mọi form dùng React Hook Form + Zod resolver.
- Schema Zod đặt trong `modules/<domain>/schemas/`, dùng chung được cho cả validate form (FE) lẫn export type request (khớp với DTO BE nếu có thể, qua `packages/types`).
- Hiển thị lỗi validate rõ ràng theo field, không alert chung chung.

## 5. Styling

- Chỉ dùng Tailwind utility classes + component từ shadcn/ui.
- Không viết CSS module/styled-components mới trừ trường hợp animation phức tạp không làm được bằng Tailwind.
- Không hardcode màu/spacing ngoài design token đã cấu hình trong `tailwind.config`.

## 6. i18n

- Toàn bộ text hiển thị cho người dùng phải qua `next-intl` (không hardcode chuỗi tiếng Việt/Anh trực tiếp trong JSX).
- Key dịch đặt theo cấu trúc `<module>.<key>`, vd `product.addToCart`.

## 7. Component con quan trọng cần lưu ý riêng

- **Variant selector** (chọn size/màu): phải xử lý rõ trạng thái hết hàng theo từng combo (disable option hết hàng, không disable cả sản phẩm).
- **Cart multi-vendor**: nhóm item theo shop khi hiển thị, tính tổng tiền riêng từng shop + tổng toàn giỏ.

## 8. Testing FE

- Vitest + React Testing Library.
- Ưu tiên test: hook có logic (useCart, useVariantSelector), component có nhiều nhánh điều kiện (variant selector, voucher input).
- Không bắt buộc test UI thuần trình bày (component chỉ render props).

## 9. Tài liệu tham khảo

- [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) — cấu trúc `features/<domain>/{components,hooks,services,types,index.ts}` gần khớp với convention ở mục 1. Dùng Vite chứ không phải Next.js App Router, chỉ tham khảo nguyên tắc tổ chức module, không copy code trực tiếp.
- [vercel/commerce](https://github.com/vercel/commerce) — Next.js Commerce 2.0, reference chính thức cho App Router + RSC + Server Actions trong e-commerce (product list/detail, cart). Mặc định bind Shopify, cần thay data layer nếu tham khảo cách fetch/hiển thị.
