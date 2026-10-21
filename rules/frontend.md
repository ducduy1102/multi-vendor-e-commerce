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
- Khi 1 trang cần dữ liệu từ **2 module không được cross-import lẫn nhau** (vd trang quản lý product cần biết "shop của tôi" — `modules/shop` — để gọi đúng API của `modules/product`), `app/<route>/page.tsx` đóng vai trò **composition root** — nơi DUY NHẤT hợp lệ để biết cả 2 phía và ghép chúng lại bằng props (vd `page.tsx` tự gọi `useMyShop()` rồi truyền `shopId` xuống `<CreateProductFormContainer shopId={...} />`), Container trong `modules/product` chỉ nhận `shopId` qua prop, không tự gọi hook của `modules/shop`. Lệch 1 chút so với nguyên tắc "page.tsx chỉ compose, logic nằm ở Container" nhưng có lý do rõ — đây không phải ngoại lệ tuỳ tiện.

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
- `zodResolver(schema)` + `useForm<T>()` cần generic `T` khớp cả 2 chiều input/output của schema. Với field **lồng sâu** (mảng-trong-mảng, vd `variants[].price`), không chỉ `z.preprocess()` mà cả `z.coerce.number()`/`.transform()`/`.default()` (mọi thứ làm input ≠ output type) đều khiến TypeScript không tự khớp nổi generic, báo lỗi mơ hồ `"Two different types with this name exist, but they are unrelated"` không trỏ thẳng dòng lỗi. Với field lồng sâu, **bỏ hết** coerce/transform/default khỏi schema — giữ input === output (vd giữ `price` dạng `string` khớp giá trị input HTML thật), tự convert sang type thật (`number`...) ở 1 hàm riêng gọi ngay trước khi báo `onSubmit`, không dựa vào Zod transform.
- Mảng lồng trong mảng (vd mỗi `attribute` có mảng `values` riêng) cần **tách component con** cho từng cấp — gọi 2 `useFieldArray` trên 2 path khác nhau (`attributes`, `attributes.${i}.values`) trong CÙNG 1 component cha không hoạt động đúng; component con nhận `attributeIndex` qua prop rồi tự gọi `useFieldArray({ control, name: `attributes.${attributeIndex}.values` })` với `control` truyền nguyên từ `useForm()` gốc.
- `register(name)` trả về object có sẵn `onBlur`/`onChange` — khai thêm `onBlur` **sau** khi spread `{...register(name)}` trong JSX sẽ **đè mất hoàn toàn** `onBlur` gốc (JSX chỉ giữ prop khai sau cùng), im lặng không báo lỗi gì, chỉ lộ ra khi cần `mode: 'onBlur'`/`isTouched` mà không thấy trigger. Muốn thêm hành vi riêng cho cùng sự kiện, giữ lại kết quả `register()` vào 1 biến rồi tự gọi cả 2: `const r = register(name); <Input {...r} onBlur={(e) => { void r.onBlur(e); customHandler(); }} />`.
- Form pre-fill dữ liệu tới **bất đồng bộ** (từ TanStack Query, chưa có sẵn lúc mount) dùng option `values` của `useForm()`, không dùng `defaultValues` — `defaultValues` chỉ đọc đúng 1 lần lúc khởi tạo form, không tự cập nhật lại khi prop đổi sau đó.

## 5. Styling

- Chỉ dùng Tailwind utility classes + component từ shadcn/ui.
- Không viết CSS module/styled-components mới trừ trường hợp animation phức tạp không làm được bằng Tailwind.
- Không hardcode màu/spacing ngoài design token đã cấu hình trong `tailwind.config`.
- Bảng dữ liệu cần responsive (desktop dạng bảng có header, mobile dạng card mỗi field tự có nhãn — vd danh sách item order/cart sau này) dùng **1 markup CSS Grid duy nhất**, không render 2 khối JSX riêng theo breakpoint (`hidden md:block` / `md:hidden`) nếu bên trong có input đi kèm `register()` — 2 khối cùng tồn tại trong DOM (chỉ ẩn bằng CSS, vẫn mount) sẽ gọi `register()` 2 lần cho cùng 1 field, react-hook-form chỉ track được 1 ref, input còn lại "câm". Dùng chung 1 template cột (`grid-cols-[...]`) cho cả header (`hidden md:grid`) và từng dòng, ẩn `<Label>` ở desktop bằng `md:sr-only` (giữ trong accessibility tree, khác `hidden` xoá hẳn) thay vì nhân đôi input.
- Khi dòng tiêu đề và các dòng dữ liệu là **các grid riêng** dùng chung một template cột (vd `ADMIN_SHOP_GRID_CLASS`), cột cuối **không dùng `auto`** mà đặt độ rộng cố định (vd `11rem`). `auto` co theo nội dung của từng grid (chữ tiêu đề ngắn hơn cụm nút) nên các cột `fr` còn lại chia khác nhau và tiêu đề lệch khỏi dữ liệu — không báo lỗi gì, chỉ lộ khi nhìn ảnh thật. jsdom không có layout nên unit test không bắt được; kiểm bằng Playwright (so `getBoundingClientRect` của từng ô tiêu đề với ô cùng cột ở dòng đầu, ở nhiều độ rộng). Cách thay thế không cần độ rộng cố định: đặt tiêu đề và các dòng trong cùng một grid (`subgrid` / `display: contents`), phức tạp hơn nên không dùng cho bảng nhỏ.
- Lưới có chứa **văn bản người dùng nhập** (lời nhắn, tên, mô tả) phải khai cột tường minh: `grid` trần ở mobile có cột ngầm định `auto` lấy **min-content** của phần tử con, và `break-words` (`overflow-wrap: break-word`) **không** thu nhỏ min-content — một chuỗi dài không dấu cách (hoặc `<textarea>` có `field-sizing: content`) làm cả cột, rồi cả trang, rộng bằng độ dài chuỗi (đã gặp: `/checkout` rộng 4425px và chi tiết đơn 3858px ở viewport 390px khi nhập lời nhắn 500 ký tự liền). Dùng `grid-cols-1` (= `minmax(0, 1fr)`) ở mobile và `lg:grid-cols-[minmax(0,1fr)_<cột phụ>]` ở desktop, **không** dùng `1fr` trần (xem `CHECKOUT_LAYOUT_CLASS`, `ORDER_DETAIL_GRID_CLASS`). jsdom không có layout nên unit test không bắt được; kiểm bằng Playwright với ca xấu nhất rồi đo `document.documentElement.scrollWidth <= clientWidth` ở 390px.
- Hộp thoại (`AlertDialogContent` — popup của shadcn là `grid` không khai cột) đã được **sửa một lần ở primitive** `shared/components/ui/alert-dialog.tsx` bằng `grid-cols-1` (đo thật: không có nó, 500 ký tự liền trong `Textarea` làm nội dung rộng ~4257–4385px ở 390px dù khung ngoài vẫn vừa màn hình), nên hộp thoại có ô nhập, hiện tại lẫn sau này, **không cần** tự thêm `grid-cols-1`. Chạy lại `shadcn add alert-dialog` sẽ ghi đè mất dòng sửa tay đó — `alert-dialog.test.tsx` sẽ đỏ để nhắc, khi đó thêm lại. Đo hộp thoại phải duyệt **MỌI phần tử con** (`getBoundingClientRect().right` của từng con ≤ bề rộng màn hình), không chỉ khung ngoài.
- Project dùng shadcn/ui với style `base-ui`/`base-nova` (không phải Radix mặc định) — 2 gotcha đã gặp khi chạy `pnpm exec shadcn add <x>`: (1) file sinh ra đôi khi tự import `cn` từ 1 package ngoài thay vì `@/shared/lib/utils` (tự thêm nhầm dependency vào `package.json`) — luôn kiểm tra + sửa lại import sau khi add; (2) `shadcn add form` là **silent no-op** (không sinh file gì, không báo lỗi) vì component `Form` chuẩn của shadcn dựa trên Radix, không tương thích base-ui — viết form thủ công bằng React Hook Form (`useForm` + `register()` + `formState.errors`), không cần wrapper `<Form>`, vẫn dùng đúng `Input`/`Label`/`Button` từ shadcn/ui.

## 6. i18n

- Toàn bộ text hiển thị cho người dùng phải qua `next-intl` (không hardcode chuỗi tiếng Việt/Anh trực tiếp trong JSX).
- Key dịch đặt theo cấu trúc `<module>.<key>`, camelCase phẳng (vd `auth.loginSubmit`), không lồng thêm cấp (không `auth.login.submit`).
- Routing đã chốt: `locales: ["vi", "en"]`, `defaultLocale: "vi"`, `localePrefix: "as-needed"` (vi không prefix, en có `/en`). Điều hướng nội bộ (Link/router) luôn import từ `@/i18n/navigation`, **không** dùng `next/link`/`next/navigation` — nếu dùng nhầm, điều hướng sẽ luôn rơi về locale mặc định thay vì giữ nguyên locale hiện tại.
- **`localeDetection: false` (Week10.md 2.3): locale CHỈ do URL quyết định.** URL không prefix (`/`, `/login`...) **luôn là tiếng Việt**, URL có `/en` luôn là tiếng Anh — bất kể header `Accept-Language` của trình duyệt hay cookie `NEXT_LOCALE`. Trước đó next-intl đoán ngôn ngữ từ hai thứ này rồi 307 sang `/en`, nên người có trình duyệt tiếng Anh vào `/` bị đẩy sang bản tiếng Anh dù sàn mặc định là tiếng Việt (đã đo bằng `curl`: `Accept-Language: en-US` hoặc cookie `NEXT_LOCALE=en` tại `/` trước đây ra `307 /en`, giờ ra `200` bản vi; test `i18n/routing.test.ts` chạy middleware next-intl thật với cấu hình thật). Middleware vẫn **ghi** cookie `NEXT_LOCALE` khi ghé `/en/...` nhưng không còn đọc nó — cookie này vô hại, đừng dựa vào nó để biết người dùng chọn ngôn ngữ nào.
- Hệ quả của việc "locale nằm hoàn toàn trong URL": (1) **không còn trí nhớ ngôn ngữ giữa các lần ghé** — người dùng chọn tiếng Anh rồi gõ thẳng `/` sẽ thấy tiếng Việt; F5 và link chia sẻ vẫn giữ nguyên vì prefix nằm trong URL, và `Link`/`useRouter` từ `@/i18n/navigation` tự giữ `/en` khi điều hướng nội bộ; (2) **mọi URL do server dựng để đưa người dùng quay lại FE phải tự gắn prefix theo ngôn ngữ của họ** — luôn qua `frontendUrl(path, locale)` (`apps/api/src/shared/mail/frontend-url.ts`), không nối `getFrontendUrl()` + path thủ công, nếu không người dùng tiếng Anh sẽ về bản tiếng Việt. Hiện có 3 nguồn ngôn ngữ, mỗi nơi dùng cái biết được: email → `User.locale`; **Google OAuth** → ngôn ngữ của trang bấm nút, `GoogleLoginButton` gửi `?locale=en` (chỉ khi khác `vi`), BE mang nó cùng `next` qua tham số `state` (`apps/api/src/shared/utils/oauth-state.ts`, kiểm lại ở cả hai đầu); **cổng thanh toán** (VNPay/mock return) → `User.locale` của chủ nhóm thanh toán (`PaymentService.findBuyerLocale`), vì cổng chỉ trả `txnRef`. Muốn chuyển **về** `vi` từ một trang `/en/...` vẫn phải link tường minh `/vi/...` (`<Link href={pathname} locale="vi">`) — next-intl tự rút gọn về URL không prefix. `LocaleSwitcher` (`shared/components/`) đã làm sẵn, dùng lại thay vì tự viết logic toggle prefix thủ công; nó **chỉ giữ pathname, rơi query string** — nơi cần giữ query (`?next=`, `?token=`) truyền prop `query` (như `AuthPageLayout`).
- Các trang xác thực không có Header (`/login`, `/register`, `/forgot-password`, `/reset-password`, xem `HIDDEN_CHROME_PATHS`) dùng `AuthPageLayout` (`shared/components/`) — card ở giữa kèm `LocaleSwitcher` phía trên, giữ `next`/`token` khi đổi ngôn ngữ. Trang mới nằm trong danh sách ẩn Header phải dùng khung này để vẫn có nút đổi ngôn ngữ (từ khi `localeDetection: false`, đây là đường duy nhất người dùng đổi ngôn ngữ tại chỗ).
- Có ít nhất 2 component instance dùng chung (form + link) → mỗi trang có 1 nút chuyển đổi ngôn ngữ khả dụng — không giả định next-intl tự có UI switcher, phải tự build.
- Trong test (Vitest + RTL), component dùng `useTranslations()`/`Link`/`useRouter` từ next-intl bắt buộc bọc `<NextIntlClientProvider locale="vi" messages={...}>` (helper có sẵn: `shared/lib/test-i18n.tsx` → `withIntl()`) — phải truyền `messages` **thật** (import từ `messages/vi.json`), không chỉ `locale` suông: thiếu `messages`, next-intl không throw lỗi mà âm thầm render ra chuỗi key thô (vd `"auth.loginSubmit"`) thay vì bản dịch, dễ làm test pass nhầm.

## 7. Component con quan trọng cần lưu ý riêng

- **Variant selector** (chọn size/màu): phải xử lý rõ trạng thái hết hàng theo từng combo (disable option hết hàng, không disable cả sản phẩm).
- **Tải ảnh lên (Cloudinary)** — Week10.md 2.4: mọi chỗ cho người dùng chọn ảnh phải qua `validateImageSelection` (kiểm **cả lượt chọn** trước khi xử lý: định dạng JPEG/PNG/WebP, ≤ 10 MB trước nén, số ảnh) rồi `compressProductImage` (thu nhỏ cạnh dài về 1600 px + WebP 0.8 bằng canvas, **không thêm thư viện**) — hai hàm ở `modules/product/components/compressProductImage.ts`, hằng số giới hạn ở `packages/types`. `accept` của `<input type="file">` chỉ là gợi ý: người dùng vẫn chọn được "mọi tệp", nên luôn kiểm lại bằng mã. Nén bằng canvas phụ thuộc trình duyệt nên đi qua "khe cắm" `ImageCodec` để unit test bằng bản giả; bản thật kiểm bằng Playwright. Ảnh chụp điện thoại cần `createImageBitmap(file, { imageOrientation: 'from-image' })` (áp EXIF) kẻo ảnh dọc bị nằm ngang. Tên file người dùng đưa vào thông báo phải cắt gọn (ca xấu nhất bố cục ở 390px).
- **Real-time (`shared/realtime/`)** — Week10.md 3.5: `RealtimeProvider` (trong `[locale]/layout.tsx`, bọc quanh Header/nội dung) chỉ giữ MỘT kết nối khi `!isHydrating` **và** có user; `socket.io-client` được `import()` **động** (`socket-factory.ts`) nên khách vãng lai không tải thêm byte nào (đã đo bằng trình duyệt thật: không chunk nào chứa mã socket.io ở `/`, `/products`, `/login`). Toàn bộ logic nối lại nằm ở `realtime-client.ts` — hàm thuần, không phụ thuộc React hay thư viện, test bằng socket giả + fake timers: tắt `reconnection` của socket.io và tự nối lại có backoff vì lỗi do middleware server từ chối (`connect_error`) và việc server ngắt (`io server disconnect`) KHÔNG được socket.io tự nối lại. Quy tắc: (1) `MISSING_TOKEN`/`INVALID_TOKEN` ⇒ gia hạn phiên (`refreshSessionNow`) **tối đa một lần mỗi lượt** rồi nối lại, vẫn bị từ chối ⇒ dừng; `ACCOUNT_NOT_ACTIVE`/`FORBIDDEN_ORIGIN` ⇒ dừng hẳn; lỗi khác ⇒ backoff 2s→30s kèm jitter; (2) **chỉ gia hạn khi tab đang hiển thị** — tab bỏ quên mà tự gia hạn mỗi 15 phút thì phiên sống mãi, trái hạn 7 ngày của refresh token; (3) server chủ động ngắt không kèm `auth:expired` (bị đá vì mở quá 5 tab, đổi mật khẩu...) ⇒ **chỉ tab đang hiển thị mới nối lại**, và bộ đếm lần thử chỉ về 0 sau khi kết nối sống ≥ 30s, để các tab không đá nhau mãi; (4) StrictMode không nhân đôi socket nhờ `generation` + nhường một microtask trước khi tạo socket (không cần `useRef` như kế hoạch ban đầu). `useRealtimeEvent(event, schema, handler)` **nhận schema Zod tường minh** (đặt cạnh thực thể ở `packages/types`) và bỏ qua im lặng payload sai hình dạng; `useRealtimeStatus()` trả `connected | connecting | offline`; cả hai an toàn khi không có Provider (offline / không làm gì).
- **Chat — dữ liệu & cache (`modules/chat`)** — Week10.md 5.1: (1) mọi dữ liệu server (hội thoại, tin, huy hiệu) ở TanStack Query; thứ DUY NHẤT nằm ngoài là **hộp chờ gửi** (`useChatOutboxStore`, Zustand) vì tin "đang gửi / gửi lỗi" là dữ liệu do chính client sinh, chưa có trên server — để trong cache thì làm mới (refetch) xoá mất. Cache chỉ giữ tin ĐÃ có trên server; ghép lúc đọc bằng `mergeMessagesWithOutbox` (tin chờ ở trên cùng, **ẩn** tin chờ mà server đã có bản cùng `clientMessageId` — không bao giờ hiện hai lần). (2) **Phạm vi** `ChatScope = { role: 'BUYER' } | { role: 'SHOP'; shopId }`: một người vừa mua vừa bán có hai hộp thư, mỗi hộp một tiền tố key (`['chat','buyer']`, `['chat','shop',shopId]`) để làm mới cả phạm vi bằng một lệnh; mọi hook bọc `scope` qua `useStableChatScope` vì nơi gọi hay viết object inline (identity mới mỗi lần render phá `useCallback`/effect). Mốc "đối phương đã đọc" và trạng thái "đang gõ" **không theo phạm vi** (payload không mang shopId) nên nằm ngoài tiền tố. (3) **Chỉ `setQueryData` lên cache ĐÃ nạp** (`upsertServerMessage`, `bumpConversationWithMessage`, `adjustUnreadCount`): ghi vào query chưa từng nạp tạo "dữ liệu" giả một phần khiến `useInfiniteQuery` bỏ qua lần nạp đầu. (4) **Huy hiệu chưa đọc KHÔNG tự `+1`** khi tin của đối phương tới — tải lại theo lô (`scheduleInvalidate`, 250 ms, một lần mỗi key): huy hiệu vừa được tải SAU khi tin tới mà còn cộng thêm là đếm đôi. Chỉ có hai chỗ chỉnh tay: `useMarkRead` (lạc quan, trừ đúng số chưa đọc của hội thoại vừa đọc) và tin của CHÍNH MÌNH làm chưa đọc về 0. `bumpConversationWithMessage` không đổi gì khi danh sách đã có tin này hay tin mới hơn (`lastMessageAt >= createdAt`) và trong nhánh đó phải trả `previousUnread: 0` — trả số thật làm nơi gọi trừ nhầm huy hiệu khi phản hồi HTTP của tin mình về muộn, sau tin trả lời mới hơn của đối phương (đã gặp ở test, có ca khoá lại). (5) **Sự kiện real-time và phản hồi HTTP của cùng một tin có thể tới theo bất kỳ thứ tự nào** (server đẩy trước khi trả lời): cả hai đi qua `applyServerMessage` (idempotent: khử trùng theo `id`/`clientMessageId`, gỡ bản tạm theo `clientMessageId`). **Thử lại tin lỗi dùng ĐÚNG `clientMessageId` cũ** — server idempotent theo khoá đó nên không tạo bản sao kể cả khi lần trước thật ra đã thành công mà phản hồi bị mất. (6) **Sau MỖI lần chuyển sang `connected`** (kể cả lần đầu) `useChatRealtimeSync` làm mới cả tiền tố phạm vi: sự kiện phát lúc không có kết nối không được gửi lại. (7) Gửi sự kiện lên server (`chat:typing`) qua `useRealtimeEmit` → `emitEvent` **không bao giờ xếp hàng** (chưa nối ⇒ `false`, bỏ): "đang gõ" gửi muộn là sai sự thật; `useSendTyping` tự giới hạn 1 lần/2,5 giây (server chặn ở 2 giây) và chỉ tính vào giới hạn khi thật sự gửi được. (8) **`chat` là module LÁ** (`module-boundaries.test.ts`): không import module nghiệp vụ nào và không module nào import `chat` — nút "Chat với shop"/"Chat với người mua" ghép ở `page.tsx`, huy hiệu Header ghép từ `shared/`. Hệ quả: **`resetChatOutbox()` phải do nơi ghép gọi khi đăng xuất/đổi tài khoản** (chat không thấy `auth`), nếu không tin "gửi lỗi" của người trước hiện cho người sau. (9) Gotcha test: TanStack Query báo thay đổi cache cho component qua hàng đợi bất đồng bộ — sau `setQueryData`/`upsert...` ngoài hook phải `await waitFor(...)`, `expect` đồng bộ đọc trúng dữ liệu cũ; kiểu của `vi.spyOn(queryClient, 'invalidateQueries')` là `MockInstance<QueryClient['invalidateQueries']>` (không phải `ReturnType<typeof vi.spyOn>`); `const SHOP: ChatScope = {...}` bị TypeScript thu hẹp về nhánh `SHOP` khi đưa vào `initialProps` của `renderHook` — ép `as ChatScope`. Test hook real-time dựng bằng `chat-test-wrapper.tsx` (QueryClient + `RealtimeProvider` + `FakeSocket`; đăng nhập giả qua `shared/realtime/test-auth.ts` để không import `modules/auth`). (10) **Dấu "Đã xem"**: mốc đối phương đã đọc có hai nguồn — `summary.otherLastReadAt` (bền vững, từ API) và sự kiện `chat:read` (tức thời, cache `['chat','read',id]`). `useOtherReadMark(conversationId, summary.otherLastReadAt)` lấy cái MỚI hơn (mốc chỉ tăng); `isSeenByOther(message, viewerRole, mark)` quyết định từng tin (chỉ tin của MÌNH, đã lên server, `createdAt <= mốc`; tin tạm không bao giờ "đã xem"). Giao diện chỉ nên gắn dấu ở tin cuối của mình đã được xem, không gắn lên mọi tin. (11) **Giao diện chat** (Week10.md 5.2): (a) **khung hộp thư cao cố định theo khung nhìn** (`CHAT_INBOX_CLASS`, `h-[calc(100dvh-…)]`) để chỉ danh sách và khung tin cuộn, ô nhập luôn trong tầm mắt; cột khai tường minh `minmax(0,1fr)` và mọi vùng `min-w-0`; bong bóng dùng `[overflow-wrap:anywhere]` + `whitespace-pre-wrap` (khác `break-words`: chỉ `anywhere` mới thu nhỏ min-content, nên chuỗi 1.000 ký tự liền không làm cột rộng ra — đã đo bằng trình duyệt thật, bỏ class ⇒ `scrollWidth` 7704 > 356); tên/tin cuối ở danh sách `truncate` trong cột `minmax(0,1fr)`. (b) **Thanh tiêu đề dùng flex, không lưới**: nút quay lại bị `display:none` từ `md` làm lưới xếp lại cột. (c) **Quy tắc cuộn của `MessageList`:** lần đầu xuống đáy; tin mới chỉ tự cuộn khi đang gần đáy (≤ 80 px) hoặc là tin của mình, đang đọc phía trên thì hiện chip "Tin mới" (chỉ đếm tin của ĐỐI PHƯƠNG); tải tin cũ giữ chỗ đang đọc bằng cách ghi `scrollHeight` ngay lúc bấm rồi bù phần chênh. Mỗi hội thoại phải có `key={conversationId}` ở nơi gọi để trạng thái cuộn khởi tạo lại. Trạng thái dẫn xuất từ props dùng "setState có điều kiện trong render" (eslint bật `react-hooks/set-state-in-effect`), effect chỉ chạm DOM; "bây giờ" lấy qua `useNow()` (không gọi `Date.now()` lúc render). (d) **Ô nhập:** Enter gửi / Shift+Enter xuống dòng, **bỏ qua Enter khi bộ gõ đang soạn** (`isComposing` hoặc `keyCode === 229` trên Safari — gõ Telex nếu thiếu sẽ gửi dở từ), dùng schema dùng chung `chatMessageFormSchema`, KHÔNG vô hiệu khi mất mạng (tin vào hộp chờ rồi "Gửi lỗi — Thử lại"); chỉ hội thoại chỉ-đọc mới vô hiệu, kèm lý do bằng chữ. (e) **Ngày giờ** qua `useChatDateFormat()` (truyền `timeZone` trình duyệt — next-intl cảnh báo `ENVIRONMENT_FALLBACK` nếu thiếu; xem `useFormatOrderDate`); nhãn "hôm nay/hôm qua" tính theo NGÀY LỊCH địa phương (`chat-format.ts`), test dựng mốc bằng thành phần giờ địa phương để đúng ở mọi múi giờ. Không assert chuỗi ngày ngắn theo locale (ICU đổi `07/01` ↔ `07-01` giữa môi trường): so với chính `Intl`. (f) Logo shop qua `ChatAvatar` dùng `shared/lib/safe-image-url` + `shared/hooks/useImageFallback` (URL tuỳ ý, chỉ https, lỗi rơi về chữ cái đầu). (g) **Đo giao diện bằng Playwright:** ép chế độ tối bằng `colorScheme: 'dark'` của ngữ cảnh — `classList.add('dark')` mâu thuẫn với `next-themes` (`defaultTheme="system"`) và cho màu sai; trang xem trước tạm dùng `Date.now()` ở client gây hydration mismatch trong dev (chỉ do dữ liệu giả, không do component: dữ liệu thật chỉ render sau khi tải ở client). Sau khi xoá trang tạm, `.next/dev/types/{validator.ts,routes.d.ts}` còn nhắc route đã xoá làm `tsc --noEmit` đỏ cho tới lần chạy `next dev` kế tiếp — gỡ dòng nhắc tới route tạm khỏi hai file sinh tự động đó (không phải mã nguồn).
- **Cart multi-vendor**: nhóm item theo shop khi hiển thị, tính tổng tiền riêng từng shop + tổng toàn giỏ.

## 8. Testing FE

- Vitest + React Testing Library.
- Test file đặt cạnh file gốc theo `rules/general.md` mục 5, hậu tố `.test.ts`/`.test.tsx` (vd `useCart.ts` → `useCart.test.ts`), không dùng thư mục `__tests__/` riêng.
- Ưu tiên test: hook có logic (useCart, useVariantSelector), component có nhiều nhánh điều kiện (variant selector, voucher input).
- Không bắt buộc test UI thuần trình bày (component chỉ render props).
- `useEffect` gọi API có tác dụng phụ **không lặp lại an toàn** (token dùng 1 lần, tạo record chỉ nên 1 lần...) phải tự chặn gọi lại trùng bằng `useRef` — React StrictMode (dev) cố ý chạy mount + effect 2 lần để lộ effect không idempotent, nếu không chặn sẽ gọi API 2 lần thật (lần 2 luôn lỗi vì tài nguyên đã dùng). Viết regression test riêng bằng cách render trong `<StrictMode>` thật rồi assert số lần gọi — test không bọc `StrictMode` sẽ không phát hiện được bug loại này.
- Test tay bằng browser thật (không chỉ Vitest/RTL) cho luồng chính có UI — dùng Playwright (headless Chromium), verify cả cookie (`context.cookies()`) khi luồng liên quan tới session/locale/theme, không chỉ nhìn text hiển thị. Viết script tạm (`node <file>.mjs`) chạy tay, không commit vào repo — xoá sau khi verify xong; `playwright` giữ lại làm devDependency lâu dài để dùng lại các tuần sau.
- 2 gotcha hay gặp khi tự viết script Playwright cho form phức tạp (nhiều field, có điều hướng sau submit): (1) `locator.blur()` chỉ có tác dụng khi gọi đúng trên phần tử **đang thật sự focus** (giống `HTMLElement.blur()` chuẩn, no-op nếu không phải phần tử active) — gọi `.blur()` ngay sau mỗi `.fill()` (lúc input đó chắc chắn còn đang focus), không gom lại rồi blur 1 lần ở cuối sau khi đã chuyển focus sang input khác; (2) đọc trạng thái UI ngay sau `page.waitForURL()`/điều hướng dễ đọc trúng lúc TanStack Query chưa kịp refetch xong — dùng `locator.waitFor()`/`toBeVisible()` (tự retry tới khi đúng hoặc timeout) thay vì `isVisible()` đọc 1 lần ngay lập tức.
- Gotcha khi kiểm tra **WebSocket** (Week10.md 3.5): (1) `page.on('websocket')` của Playwright **không** bắn `close` khi trang điều hướng/F5 nên đếm "đang mở" từ sự kiện sẽ lệch — bọc `window.WebSocket` bằng `context.addInitScript` rồi đếm `readyState === OPEN` ngay trong trang; (2) `context.setOffline(true)` **không** đóng WebSocket đang mở (chờ ping timeout ~45s) — mô phỏng mất đường truyền bằng cách `close()` thẳng WebSocket trong trang; (3) `socket.io-client` chạy trên **Node** với `withCredentials: true` tự dựng header `cookie` (chữ thường) và ghi đè header `Cookie` bạn truyền — dùng khoá `cookie` chữ thường trong `extraHeaders` (trình duyệt không dính, cookie do trình duyệt tự gửi); (4) reset store Zustand trong `afterEach` phải đi sau `cleanup()` của RTL, nếu không React cập nhật ngoài `act()` và in cảnh báo.
- Component **Container** (nối UI thuần với hook/service, dùng `useRouter` từ `@/i18n/navigation`) không bắt buộc unit test — mock router của next-intl phức tạp không cần thiết, dựa vào Playwright test tay cho luồng điều hướng thay vào đó (vd `LoginFormContainer`/`RegisterFormContainer` không có test, chỉ `LoginForm`/`RegisterForm` — component thuần, không router — mới có).
- Test phủ định "**KHÔNG gọi API**" phải **chờ hết việc đang treo** rồi mới khẳng định (vd `await act(async () => { await new Promise((r) => setTimeout(r, 0)); })`), và nên khẳng định cả không có lỗi giả (`actionError` null). `useMutation` chỉ gọi service sau vài microtask nên `expect(service).not.toHaveBeenCalled()` ngay sau `act` đồng bộ **luôn đúng, kể cả khi code sai** — đã gặp: đột biến xoá kiểm loại hộp thoại ở 3 luồng hành động vẫn qua toàn bộ test. Kiểm bằng cách phá thử đúng đoạn guard rồi xác nhận test chuyển đỏ.

## 9. Tài liệu tham khảo

- [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) — cấu trúc `features/<domain>/{components,hooks,services,types,index.ts}` gần khớp với convention ở mục 1. Dùng Vite chứ không phải Next.js App Router, chỉ tham khảo nguyên tắc tổ chức module, không copy code trực tiếp.
- [vercel/commerce](https://github.com/vercel/commerce) — Next.js Commerce 2.0, reference chính thức cho App Router + RSC + Server Actions trong e-commerce (product list/detail, cart). Mặc định bind Shopify, cần thay data layer nếu tham khảo cách fetch/hiển thị.

## 10. Trạng thái tải dữ liệu (loading/empty/error) & primitive shadcn đã duyệt

Áp dụng cho **mọi** danh sách/trang dữ liệu, kể cả code mới — khác mục "UI polish (Chốt)" bên dưới (mục đó chỉ áp dụng khi task là audit/polish trang đã có). Phát hiện khi làm Tuần 4 (`ProductFormSkeleton`) rằng pattern này đã dùng ở ≥2 chỗ độc lập (`SellerProductsListSkeleton`, `ProductFormSkeleton`), không còn là polish riêng lẻ mà là convention chung — Tuần 5 trở đi (trang chi tiết sản phẩm, trang wishlist...) áp dụng ngay từ lúc code, không đợi tới đợt audit sau mới thêm.

- Mọi danh sách và trang dữ liệu phải có đủ: **loading** (dùng `Skeleton`), **empty**, **error**.
- **Loading dùng `Suspense` đặt sát phần dữ liệu** (component async bọc trong `<Suspense fallback={<...Skeleton />}>`). **Không** đặt `loading.tsx` ở cấp `app/[locale]/`, vì nó sẽ áp lên mọi route con (login, register, seller...) và hiện sai khung.
- Skeleton phải **khớp kích thước và bố cục** với nội dung thật (cùng tỷ lệ ảnh, cùng lưới, cùng số cột) để không bị nhảy layout khi dữ liệu về. Dùng chung hằng số class lưới giữa lưới thật và lưới skeleton (vd export `VARIANT_GRID_COLS`/`HOME_CATALOG_GRID_CLASS` rồi import lại ở file skeleton), để hai bên không lệch nhau — xem `ProductCardSkeleton`/`SellerProductsListSkeleton`/`ProductFormSkeleton` làm ví dụ.
- Skeleton chỉ mang tính trang trí: `aria-hidden`. Vùng bọc có `aria-busy="true"` kèm một dòng chữ `sr-only` đã dịch (vi và en). Thêm `motion-reduce:animate-none` để tôn trọng `prefers-reduced-motion`.
- Error dùng `app/[locale]/error.tsx` chung (Client Component). Không hiển thị `error.message` hay stack cho người dùng.
- Nút submit phải `disabled` khi đang gửi. Thao tác nguy hiểm phải có xác nhận.
- Input và nút cần trạng thái `focus-visible` rõ ràng, vùng bấm đủ lớn trên mobile.
- **Primitive shadcn/ui đã được duyệt sẵn** (dùng thẳng khi cần, không phải hỏi lại): `Skeleton` (`shadcn add skeleton`), `Sheet` (`shadcn add sheet`), `AlertDialog` (`shadcn add alert-dialog`). Primitive khác (`Card`, `Avatar`...) vẫn phải hỏi trước khi thêm.

## UI polish (Chốt)

Áp dụng khi task là "audit / polish / cải thiện UI" cho các trang đã có.

**Thứ tự ưu tiên khi mâu thuẫn:** `rules/general.md` và các mục còn lại của file này > mục "UI polish" này > skill ngoài (`shadcn`, `vercel-react-best-practices`). Skill chỉ là gợi ý bổ sung, không phải mệnh lệnh.

### 1. Quy trình bắt buộc

- Luôn **audit trước, chưa sửa code**. Liệt kê vấn đề theo mức ưu tiên (file, vấn đề, cách sửa đề xuất, độ rủi ro với test và i18n), chờ người dùng duyệt.
- Chỉ sửa **đúng các mục đã duyệt**, không làm thêm ngoài danh sách.
- Mỗi lần sửa gói trong một nhóm nhỏ, mỗi trang một commit.
- Cuối mỗi lần, báo rõ: file đã đổi, skill nào đã áp dụng quy tắc nào, việc nào không làm được và vì sao.

### 2. Thương hiệu và màu

- Màu chủ đạo: xanh ngọc `#0F766E` (primary). Điểm nhấn: cam `#E8552B` (accent). Chữ và nền trung tính dùng token có sẵn.
- Chuyển hai màu trên sang đúng định dạng token đang dùng trong `globals.css` (không tự đổi hệ màu).
- Chỉ dùng **semantic color** (`bg-primary`, `text-muted-foreground`, `border`...). **Cấm** màu thô (`bg-blue-500`, `#hex`, `text-neutral-500`) trong component.
- Accent (cam) chỉ dùng cho điểm nhấn: badge, giá khuyến mãi, CTA phụ. **Không** dùng cho nút Xoá/Huỷ/Lưu trữ.
- `--destructive` phải khác hue rõ rệt với accent để nút nguy hiểm và nút hành động chính không giống nhau. Kiểm tra bằng mắt ở cả light và dark.
- Giữ tối đa 2-3 màu thương hiệu xuất hiện trên một màn hình.

### 3. Mật độ và chuyển động

- Đây là marketplace: **mật độ thông tin cao**. Card gọn, ưu tiên hiển thị ảnh, tên, giá, shop. Không dùng khoảng trắng quá lớn hay layout bất đối xứng kiểu landing page.
- Chuyển động **tối thiểu**: chỉ transition ngắn (hover, focus, mở/đóng), tôn trọng `prefers-reduced-motion`.
- **Không** thêm GSAP, framer-motion hay hiệu ứng theo cuộn nếu chưa hỏi.
- Header và nội dung chính dùng **chung một container căn giữa** (`mx-auto w-full max-w-screen-xl px-4`), không để header tràn full-width còn nội dung lệch trái.

### 4. Trạng thái bắt buộc

Xem "## 10. Trạng thái tải dữ liệu..." ở đầu file (loading/empty/error, Skeleton, primitive đã duyệt) — áp dụng chung, không riêng audit. Khi audit, kiểm tra đúng các điểm ở đó cho trang đang xét và liệt kê vào danh sách vấn đề nếu thiếu.

### 5. Responsive và giao diện sáng/tối

- **Ranh giới điều hướng mobile/desktop dùng thống nhất `sm:` (640px)** trên toàn app — mọi cặp ẩn/hiện kiểu `hidden sm:flex` / `sm:hidden` liên quan đến chuyển đổi giữa `BottomTabBar` (mobile) và Header/nav ngang (desktop) phải dùng cùng một breakpoint, không được lệch nhau (ví dụ một bên `sm:`, một bên `md:`), vì sẽ tạo khoảng chết không có điều hướng nào hiện. `md:`/`lg:` vẫn dùng bình thường cho mục đích khác (số cột lưới, kích thước chữ...), chỉ riêng cặp ẩn/hiện điều hướng là bắt buộc `sm:`.
- Kiểm tra ở **390px**: không tràn ngang, filter và thanh công cụ tự xuống dòng.
- Kiểm tra cả **light và dark**. Không hardcode màu làm hỏng một trong hai chế độ.

### 6. i18n

- Mọi chuỗi hiển thị đi qua `next-intl`, cập nhật **cả `vi` và `en`**.
- Không đổi hoặc xoá key hiện có nếu chưa cập nhật mọi chỗ dùng.
- Giá tiền dùng `Intl.NumberFormat`, đơn vị VND, **định dạng cố định `vi-VN` cho mọi locale** (chủ đích, giống nhiều sàn quốc tế). Không nối chuỗi thủ công. Dùng chung hàm `formatPrice` của module `product`, không định nghĩa lại ở nơi khác.

### 7. Kiến trúc (giữ nguyên quy ước hiện có)

- Mặc định là Server Component. Chỉ dùng `"use client"` khi thật sự cần tương tác.
- `page.tsx` chỉ compose, logic nằm trong Container. Component UI thuần nhận dữ liệu qua props.
- **Không cross-import giữa các module** (`product` và `shop` không import lẫn nhau). Chỗ ghép hai domain giữ ở `page.tsx` như `seller/products/page.tsx`.
- Không đổi hành vi nghiệp vụ, URL params, phân trang, query key, schema Zod hay API.

### 8. shadcn/ui

- **Dùng lại** component và variant có sẵn (`Card`, `Badge`, `Skeleton`, `Button variant=...`) trước khi viết mới.
- Style là `base-nova` (`@base-ui/react`). Không dùng wrapper `Form` kiểu Radix.
- Nếu chạy `shadcn add`: kiểm tra file sinh ra có import `cn` từ package ngoài không (phải là `@/shared/lib/utils`) và có tự thêm dependency `cn` không. Sửa import và gỡ dependency thừa (xem mục 5).
- Danh sách primitive đã duyệt sẵn (`Skeleton`/`Sheet`/`AlertDialog`) xem "## 10. Trạng thái tải dữ liệu..." ở đầu file — `Skeleton` dùng cho `AccountSheet`, `AlertDialog` dùng cho xác nhận hành động nguy hiểm (vd "Lưu trữ" sản phẩm ở `/seller/products`, thay `window.confirm()`). Primitive khác vẫn phải hỏi trước.
- Chỉ thêm primitive khi chính component đó được dùng ngay trong đợt sửa, không thêm sẵn "phòng khi cần".

### 9. Hiệu năng (`vercel-react-best-practices`)

- Tránh waterfall: các fetch độc lập chạy song song (`Promise.all`), không `await` nối tiếp không cần thiết.
- Không import cả thư viện nặng khi chỉ cần một phần, không đẩy thêm JS xuống client không cần.
- Ảnh dùng `next/image` với `sizes`/kích thước phù hợp, ảnh đầu trang ưu tiên tải sớm.
- Đo **Lighthouse trước và sau** cho `/` và `/products`. Nếu điểm giảm thì hoàn tác thay đổi đó.

### 10. Thư viện

- **Không thêm dependency npm mới** nếu chưa hỏi người dùng.
- Primitive shadcn chỉ được thêm khi nằm trong danh sách đã duyệt ở mục 8 hoặc người dùng đã đồng ý trong bước duyệt audit.

### 11. Hoàn thành khi (definition of done)

- `tsc --noEmit`, `eslint`, `prettier --check` sạch.
- `vitest run` pass, **không giảm số test**.
- `next build` thành công.
- Test tay bằng Playwright: desktop và 390px, light và dark, `vi` và `en`.
- Không viết unit test cho Container (theo mục 8). Component UI thuần có logic mới thì thêm test cạnh file gốc (theo `rules/general.md` mục 5).

### 12. Không làm

- Không viết lại kiến trúc, không refactor lớn ngoài danh sách đã duyệt.
- Không xoá hay sửa test để cho qua.
- Không đổi copy hoặc bản dịch ngoài phạm vi audit.

### 13. Quyết định đã chốt (không đề xuất lại khi audit)

Các mục dưới đây đã được cân nhắc và quyết định. Khi audit, **không** đưa vào danh sách vấn đề, trừ khi có thay đổi phạm vi.

- **Trang chủ và `/products` là dynamic (`ƒ`)**, không thêm cache hay `revalidate`. Sản phẩm publish hoặc archive phải hiện ngay.
- **`isHydrating` trong `useAuthStore`** là cách chống nháy Guest và User. `useAuthStore` vẫn là nguồn duy nhất cho user hiện tại, không fetch lại bằng React Query.
- **Mục "Trang cá nhân" trong dropdown** từng ẩn cho đến khi có trang tài khoản thật. **[Cập nhật — Tuần 9, 6.2]** Đã bật: trỏ `/account` (hồ sơ, sổ địa chỉ `/account/addresses`, đổi/đặt mật khẩu `/account/password`), đứng **đầu** menu ở cả `Header` (dropdown desktop) lẫn `AccountSheet` (mobile), trước "Đơn hàng của tôi", dùng chung key `header.myAccountLink`. **[Cập nhật — Tuần 8]** "Đơn hàng của tôi" (`/orders`) đã có route thật nên **được thêm thẳng** vào dropdown tài khoản (`Header`, desktop) và `AccountSheet` (mobile), đứng trước mục kênh người bán — không đợi trang tài khoản tổng. Wishlist (`/wishlist`) và Đơn hàng cố tình là route riêng, không gộp vào "Trang cá nhân". Cả hai nơi dùng cùng key `header.myOrdersLink`; ranh giới ẩn/hiện vẫn là `sm:` (dropdown thuộc cụm desktop, `AccountSheet` thuộc `BottomTabBar` mobile), không thêm tab thứ 5 vào `BottomTabBar`.
- **Banner xác thực email không có nút đóng** (chủ đích, nhắc liên tục).
- **Điều hướng mobile dùng bottom tab bar** (3 tab: Trang chủ, Sản phẩm, Tài khoản; layout chừa sẵn cho tab Cart thứ 4 ở Tuần 6), **không dùng Sheet hamburger** (đã bỏ vì trùng lặp với menu tài khoản). Tab "Tài khoản" mở `AccountSheet` — một Sheet duy nhất gộp cả `ThemeToggle`, `LocaleSwitcher` và menu tài khoản trước đây. Header mobile: logo hàng 1 + **thanh search hàng 2** (theo yêu cầu bổ sung sau Tuần 5 — ban đầu chỉ chừa chỗ ở desktop, sau đó thêm cả mobile; dùng chung đúng 1 component/1 input DOM cho mọi breakpoint, `Container` cha bật `flex-wrap` + `HeaderSearchForm` tự `w-full` ở mobile khiến nó rớt xuống dòng riêng, không render 2 bản JSX theo breakpoint — đúng nguyên tắc ở mục 5 "Bảng dữ liệu cần responsive"). Giỏ hàng, thông báo vẫn chỉ **chừa chỗ** ở Header desktop, làm theo roadmap (Tuần 6, 10). Không tạo link tới trang chưa tồn tại.
- **`AccountSheet` giữ mở khi đổi ngôn ngữ hoặc theme** (nhất quán giữa hai control). Trạng thái mở/đóng được nâng lên `useUIStore` (Zustand, `shared/store/ui.store.ts`) thay vì `useState` cục bộ, vì đổi locale gây điều hướng làm remount cây con dưới `[locale]`, còn Zustand sống ở module scope nên không bị mất khi remount. Phạm vi store chỉ giữ đúng 1 boolean cho nhu cầu này, không tổng quát hoá thành quản lý nhiều dialog.
- **Chưa tách `AccountMenu` khỏi Header**, làm khi có test cho Header.
- **`ProductPreviewCard` là Server Component dùng chung** cho `/` và `/products`. Không thêm `"use client"` chỉ để xử lý ảnh lỗi (`onError`). Thiếu ảnh dùng placeholder `ImageOff`.
- **Tên shop trên card** cần đổi BE (`productCardSchema`), làm cùng trang chi tiết sản phẩm ở Tuần 5.
- **Header là một tầng** (không tách thanh utility phía trên). **[Cập nhật — Tuần 5]** Nav ngang hàng "Sản phẩm"/"Kênh người bán" cạnh logo đã **bỏ hẳn theo yêu cầu người dùng** (không phải audit tự đề xuất) — vào `/products` qua thanh search ở Header hoặc trang chủ, vào khu seller qua dropdown tài khoản (`shopLink` vẫn còn nguyên trong `DropdownMenuContent`, chỉ bỏ bản nav ngang hàng). `HeaderNavLink` helper cũng đã xoá theo (không còn chỗ dùng). Component `HeaderSearchForm` (Tuần 5 Bước 3.5) giờ đứng ngay cạnh logo.
- **Hero trang chủ chỉ có 1 banner lớn**, dựng bằng CSS/SVG (không ảnh ngoài, không carousel): `<h1>` ngắn và một nút. Đã bỏ 2 banner nhỏ vì trùng đích với mục nav "Sản phẩm" và "Kênh người bán" khi chưa có nội dung nào khác biệt để lấp vào — **lý do gốc này đã lung lay** từ khi bỏ hẳn 2 mục nav đó (dòng trên), nhưng chưa xét lại quyết định Hero ở đây (ngoài phạm vi yêu cầu bỏ nav, chỉ ghi chú lại để lần audit sau biết mà xem lại nếu cần). Carousel động chờ banner do Admin quản lý (Tuần 11). Chỉ tham khảo bố cục của các sàn khác, **không sao chép** hình, chữ, màu hay icon của họ.
- **Icon danh mục ánh xạ theo `slug` ở FE** (`lucide-react`, kèm icon dự phòng) vì `categorySchema` chưa có field icon.
- **`UserAvatar` chữ cái đầu viết tay**, chưa dùng `Avatar` của shadcn vì chưa có ảnh đại diện.
- **Ảnh Cloudinary không transform lúc upload**, `next/image` tối ưu ở output. Xem lại khi tối ưu hiệu năng sâu hơn.
- **Điều hướng "Kênh người bán"** khi đã có shop vẫn trỏ `/seller/products` (dùng thường xuyên hơn). `/seller/shop` được vào qua 1 link nhỏ "Thông tin shop" đặt trên `/seller/products`, không qua Header/AccountSheet.
- **Không nhân đôi lời nhắc xác thực email**: `BecomeSellerFormContainer` không tự vẽ Alert + nút "Gửi lại xác thực" riêng nữa (trùng banner toàn cục `EmailVerificationBanner`), chỉ còn 1 dòng text ngắn giải thích vì sao form đang khoá.
- **`/seller/onboarding` và `/seller/shop` dùng chung độ rộng `max-w-lg`** (đồng bộ banner trạng thái, tiêu đề và form trên cùng trang, và giữa 2 trang với nhau).
