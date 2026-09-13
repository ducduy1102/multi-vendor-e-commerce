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
  shared/
    components/           # UI dùng chung (Button, Modal, Skeleton...)
    hooks/                 # hook dùng chung (useDebounce, useMediaQuery...)
    lib/                    # api client, constants, utils thuần
    types/
  app/
    [locale]/              # MỌI route/layout nằm trong đây, kể cả route mới tạo
      layout.tsx           # sau này (app/[locale]/<route>/page.tsx, không phải
      page.tsx             # app/<route>/page.tsx) — bắt buộc do next-intl App
      <route>/page.tsx     # Router yêu cầu locale phải là 1 route param thật.
    globals.css            # CSS/asset tĩnh vẫn ở app/ gốc, không vào [locale]/
  i18n/                    # routing.ts, navigation.ts, request.ts (next-intl)
```

**Quy tắc:** file trong `app/` (page.tsx, layout.tsx) chỉ compose component từ `modules/`, không viết logic nghiệp vụ trực tiếp ở đây.

**Middleware**: Next.js 16 dùng file `proxy.ts` (export tên `proxy`), **không phải** `middleware.ts` (đã deprecated) — tồn tại đồng thời cả 2 file gây lỗi runtime im lặng (route liên quan trả response rỗng, không throw rõ ràng), chỉ lộ ra khi test tay bằng browser thật. Chỉ có **1 file** `proxy.ts` cho toàn app — nếu cần cả middleware của 1 thư viện (vd `next-intl`'s `createMiddleware`) lẫn guard tự viết (vd chặn route theo cookie), phải tự compose logic vào chung 1 hàm `proxy()`, chạy tuần tự theo đúng thứ tự ưu tiên, không viết 2 file riêng. Guard trong `proxy.ts` chỉ nên check điều kiện đọc trực tiếp được từ cookie/header (vd có token hay không) — điều kiện cần query DB (vd user đã có shop/quyền thao tác resource cụ thể chưa) phải đẩy xuống Server/Client Component (qua service/hook), không cố nhét vào middleware.

## 2. Server Component vs Client Component

- Mặc định **Server Component**. Chỉ thêm `"use client"` khi thật sự cần: state, event handler, browser API, hoặc dùng hook client-only (Zustand, TanStack Query hook).
- Data fetch ban đầu (SSR) nên thực hiện ở Server Component gọi thẳng service/API, không dùng TanStack Query cho lần fetch đầu nếu không cần.
- Component tương tác nhiều (filter, cart, variant selector, chat) mới cần Client Component + TanStack Query/Zustand.
- Cần đọc query param (`?xxx=`) 1 lần lúc render, không cần theo dõi thay đổi khi ở lại trang: đọc qua prop `searchParams` ở Server Component (page nhận `Promise<{...}>`, `await` rồi dùng), **không** dùng hook `useSearchParams()` — hook đó bắt buộc Client Component + bọc `<Suspense>`, phức tạp hơn không cần thiết cho nhu cầu đọc 1 lần.
- Ranh giới Server/Client Component do **nơi gọi (import) quyết định, không phải nơi khai báo**: Next.js không cho Server Component làm con trực tiếp của Client Component qua `import` thường — nếu 1 component không có `"use client"` nhưng chỉ được `import` từ 1 Client Component khác, nó vẫn bị kéo vào client bundle (Next.js không báo lỗi, chỉ âm thầm bundle). Nếu rơi vào trường hợp này, khai `"use client"` tường minh dù component chưa dùng API nào đòi client — tránh nhầm là Server Component thật khi đọc lại code sau này.

## 3. State management — khi nào dùng gì

| Loại state | Dùng |
|---|---|
| State chỉ 1 component (input, toggle) | `useState` |
| State chia sẻ nhiều component/route (cart, auth user, sidebar) | Zustand |
| Dữ liệu từ server (product list, order history) | TanStack Query |
| Dữ liệu form | React Hook Form (không đưa vào Zustand) |

Không đưa server data vào Zustand store — TanStack Query đã lo cache/refetch, tránh trùng lặp nguồn sự thật (source of truth). Ngược lại, **không dùng TanStack Query để fetch lại dữ liệu user/session hiện tại** nếu đã có Zustand store riêng cho việc đó (`useAuthStore` + `AuthHydrator`) — chỉ dùng React Query cho server state thật sự mới (shop, product...), tránh có 2-3 nguồn khác nhau cùng đại diện cho 1 khái niệm "user hiện tại" (Zustand + React Query + cookie) dễ lệch nhau.

Component dùng `useQuery` phải xử lý riêng cả 3 trạng thái `isPending`/`isError`/thành công khi có nhánh render khác nhau theo trạng thái — bỏ sót `isError` không báo lỗi TypeScript hay crash gì cả, chỉ lộ ra khi thật sự gặp lỗi khác trường hợp đã lường trước (vd chỉ xử lý `404 → null` nhưng gặp `401` thật), khiến UI treo mãi ở trạng thái loading.

## 4. Form & validate

- Mọi form dùng React Hook Form + Zod resolver.
- Schema Zod đặt trong `modules/<domain>/schemas/`, dùng chung được cho cả validate form (FE) lẫn export type request (khớp với DTO BE nếu có thể, qua `packages/types`).
- Hiển thị lỗi validate rõ ràng theo field, không alert chung chung.
- Field optional dạng string trong Zod schema dùng cho `zodResolver` (React Hook Form): input bỏ trống gửi lên chuỗi rỗng `""`, không phải `undefined` — nếu cần coi `""` là chưa nhập, xử lý bằng `.optional().transform(v => v === '' ? undefined : v)` ở **cuối** chain, **không** dùng `z.preprocess()` ở đầu chain (khiến input type của field đó suy ra thành `unknown`, làm `useForm<T>({ resolver: zodResolver(schema) })` báo lỗi type `Resolver<...>` không khớp).
- Form pre-fill dữ liệu tới **bất đồng bộ** (từ TanStack Query, chưa có sẵn lúc mount) dùng option `values` của `useForm()`, không dùng `defaultValues` — `defaultValues` chỉ đọc đúng 1 lần lúc khởi tạo form, không tự cập nhật lại khi prop đổi sau đó.

## 5. Styling

- Chỉ dùng Tailwind utility classes + component từ shadcn/ui.
- Không viết CSS module/styled-components mới trừ trường hợp animation phức tạp không làm được bằng Tailwind.
- Không hardcode màu/spacing ngoài design token đã cấu hình trong `tailwind.config`.
- Project dùng shadcn/ui với style `base-ui`/`base-nova` (không phải Radix mặc định) — 2 gotcha đã gặp khi chạy `pnpm exec shadcn add <x>`: (1) file sinh ra đôi khi tự import `cn` từ 1 package ngoài thay vì `@/shared/lib/utils` (tự thêm nhầm dependency vào `package.json`) — luôn kiểm tra + sửa lại import sau khi add; (2) `shadcn add form` là **silent no-op** (không sinh file gì, không báo lỗi) vì component `Form` chuẩn của shadcn dựa trên Radix, không tương thích base-ui — viết form thủ công bằng React Hook Form (`useForm` + `register()` + `formState.errors`), không cần wrapper `<Form>`, vẫn dùng đúng `Input`/`Label`/`Button` từ shadcn/ui.

## 6. i18n

- Toàn bộ text hiển thị cho người dùng phải qua `next-intl` (không hardcode chuỗi tiếng Việt/Anh trực tiếp trong JSX).
- Key dịch đặt theo cấu trúc `<module>.<key>`, camelCase phẳng (vd `auth.loginSubmit`), không lồng thêm cấp (không `auth.login.submit`).
- Routing đã chốt: `locales: ["vi", "en"]`, `defaultLocale: "vi"`, `localePrefix: "as-needed"` (vi không prefix, en có `/en`). Điều hướng nội bộ (Link/router) luôn import từ `@/i18n/navigation`, **không** dùng `next/link`/`next/navigation` — nếu dùng nhầm, điều hướng sẽ luôn rơi về locale mặc định thay vì giữ nguyên locale hiện tại.
- next-intl nhớ lựa chọn locale qua cookie `NEXT_LOCALE`: ghé 1 URL có prefix (vd `/en/...`) sẽ ghi đè cookie, khiến các lần ghé URL không-prefix sau đó cũng bị redirect theo cookie đã nhớ (không tự về `vi`). Muốn chuyển **về** locale mặc định phải link tường minh `/vi/...` (`<Link href={pathname} locale="vi">`) — next-intl tự rút gọn URL + cập nhật lại cookie. `LocaleSwitcher` (`shared/components/`) đã làm sẵn theo đúng cơ chế này, dùng lại thay vì tự viết logic toggle prefix thủ công.
- Có ít nhất 2 component instance dùng chung (form + link) → mỗi trang có 1 nút chuyển đổi ngôn ngữ khả dụng — không giả định next-intl tự có UI switcher, phải tự build.
- Trong test (Vitest + RTL), component dùng `useTranslations()`/`Link`/`useRouter` từ next-intl bắt buộc bọc `<NextIntlClientProvider locale="vi" messages={...}>` (helper có sẵn: `shared/lib/test-i18n.tsx` → `withIntl()`) — phải truyền `messages` **thật** (import từ `messages/vi.json`), không chỉ `locale` suông: thiếu `messages`, next-intl không throw lỗi mà âm thầm render ra chuỗi key thô (vd `"auth.loginSubmit"`) thay vì bản dịch, dễ làm test pass nhầm.

## 7. Component con quan trọng cần lưu ý riêng

- **Variant selector** (chọn size/màu): phải xử lý rõ trạng thái hết hàng theo từng combo (disable option hết hàng, không disable cả sản phẩm).
- **Cart multi-vendor**: nhóm item theo shop khi hiển thị, tính tổng tiền riêng từng shop + tổng toàn giỏ.

## 8. Testing FE

- Vitest + React Testing Library.
- Test file đặt cạnh file gốc theo `rules/general.md` mục 5, hậu tố `.test.ts`/`.test.tsx` (vd `useCart.ts` → `useCart.test.ts`), không dùng thư mục `__tests__/` riêng.
- Ưu tiên test: hook có logic (useCart, useVariantSelector), component có nhiều nhánh điều kiện (variant selector, voucher input).
- Không bắt buộc test UI thuần trình bày (component chỉ render props).
- `useEffect` gọi API có tác dụng phụ **không lặp lại an toàn** (token dùng 1 lần, tạo record chỉ nên 1 lần...) phải tự chặn gọi lại trùng bằng `useRef` — React StrictMode (dev) cố ý chạy mount + effect 2 lần để lộ effect không idempotent, nếu không chặn sẽ gọi API 2 lần thật (lần 2 luôn lỗi vì tài nguyên đã dùng). Viết regression test riêng bằng cách render trong `<StrictMode>` thật rồi assert số lần gọi — test không bọc `StrictMode` sẽ không phát hiện được bug loại này.
- Test tay bằng browser thật (không chỉ Vitest/RTL) cho luồng chính có UI — dùng Playwright (headless Chromium), verify cả cookie (`context.cookies()`) khi luồng liên quan tới session/locale/theme, không chỉ nhìn text hiển thị. Viết script tạm (`node <file>.mjs`) chạy tay, không commit vào repo — xoá sau khi verify xong; `playwright` giữ lại làm devDependency lâu dài để dùng lại các tuần sau.
- Component **Container** (nối UI thuần với hook/service, dùng `useRouter` từ `@/i18n/navigation`) không bắt buộc unit test — mock router của next-intl phức tạp không cần thiết, dựa vào Playwright test tay cho luồng điều hướng thay vào đó (vd `LoginFormContainer`/`RegisterFormContainer` không có test, chỉ `LoginForm`/`RegisterForm` — component thuần, không router — mới có).

## 9. Tài liệu tham khảo

- [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) — cấu trúc `features/<domain>/{components,hooks,services,types,index.ts}` gần khớp với convention ở mục 1. Dùng Vite chứ không phải Next.js App Router, chỉ tham khảo nguyên tắc tổ chức module, không copy code trực tiếp.
- [vercel/commerce](https://github.com/vercel/commerce) — Next.js Commerce 2.0, reference chính thức cho App Router + RSC + Server Actions trong e-commerce (product list/detail, cart). Mặc định bind Shopify, cần thay data layer nếu tham khảo cách fetch/hiển thị.
