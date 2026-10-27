import { z } from 'zod';
import { isSafeMultilineText, isSafeName } from './text-safety';

export const shopStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export type ShopStatus = z.infer<typeof shopStatusSchema>;

// Ai thực hiện 1 lần chuyển trạng thái shop (ShopStatusHistory.actorType) — khớp enum Prisma
// ShopActorType (test parity ở BE). SYSTEM chỉ có đúng hai cạnh (APPROVED ⇄ SUSPENDED) cho việc Admin khoá / mở lại TÀI
// KHOẢN chủ shop kéo theo shop của họ (Week11.md 3.4); SYSTEM không bao giờ duyệt hay từ chối shop.
export const shopActorTypeSchema = z.enum(['OWNER', 'ADMIN', 'SYSTEM']);
export type ShopActorType = z.infer<typeof shopActorTypeSchema>;

export interface ShopStatusTransition {
  from: ShopStatus;
  to: ShopStatus;
  actor: ShopActorType;
}

// MỘT state machine duy nhất cho Shop.status, mỗi cạnh kèm ACTOR được phép thực hiện (Week8.md 3C.1):
//   PENDING   → APPROVED   ADMIN
//   PENDING   → REJECTED   ADMIN   (bắt buộc lý do)
//   REJECTED  → PENDING    OWNER   (chủ shop "gửi duyệt lại")
//   APPROVED  → SUSPENDED  ADMIN   (bắt buộc lý do)
//   SUSPENDED → APPROVED   ADMIN
//   APPROVED  → SUSPENDED  SYSTEM  (Admin khoá / cấm tài khoản chủ shop ⇒ tự khoá shop của họ, Week11.md 3.4)
//   SUSPENDED → APPROVED   SYSTEM  (Admin mở lại tài khoản bị TẠM KHOÁ ⇒ tự mở lại đúng shop do lần khoá đó khoá)
// Chủ shop không bao giờ tự APPROVED; Admin không thực hiện được cạnh của Owner (và ngược lại). Hai cạnh SYSTEM trùng cặp
// (from, to) với hai cạnh ADMIN nhưng KHÁC actor — bất biến là "mỗi bộ ba (from, to, actor) xuất hiện một lần", không phải
// "mỗi cặp một actor". Chỉ nói cạnh nào hợp lệ + ai làm được; thực thi thật nằm ở ShopStatusService (UPDATE có điều kiện
// WHERE status = <cũ>). Cố ý KHÔNG có hàm "cạnh này có tồn tại với bất kỳ ai không" — kiểm cạnh mà không kèm actor là cách
// để AdminService vô tình cho phép cạnh của Owner.
export const SHOP_STATUS_TRANSITIONS: readonly ShopStatusTransition[] = [
  { from: 'PENDING', to: 'APPROVED', actor: 'ADMIN' },
  { from: 'PENDING', to: 'REJECTED', actor: 'ADMIN' },
  { from: 'REJECTED', to: 'PENDING', actor: 'OWNER' },
  { from: 'APPROVED', to: 'SUSPENDED', actor: 'ADMIN' },
  { from: 'SUSPENDED', to: 'APPROVED', actor: 'ADMIN' },
  { from: 'APPROVED', to: 'SUSPENDED', actor: 'SYSTEM' },
  { from: 'SUSPENDED', to: 'APPROVED', actor: 'SYSTEM' },
];

// Mã ghi vào `Shop.statusReason` và `ShopStatusHistory.note` khi một shop bị khoá VÌ tài khoản chủ shop bị Admin khoá / cấm
// (Week11.md 3.4). Là MÃ chứ không phải câu chữ: BE dùng nó để nhận ra "dòng cascade" khi mở lại (chỉ mở lại shop mà dòng
// lịch sử mới nhất là dòng này), FE dùng nó để hiện câu đã dịch thay vì in nguyên mã cho người dùng.
export const SHOP_CASCADE_SUSPEND_REASON = 'OWNER_ACCOUNT_SUSPENDED';

export function canActorTransitionShop(
  actor: ShopActorType,
  from: ShopStatus,
  to: ShopStatus,
): boolean {
  return SHOP_STATUS_TRANSITIONS.some(
    (edge) => edge.actor === actor && edge.from === from && edge.to === to,
  );
}

// Các trạng thái đích `actor` được đưa 1 shop đang ở `from` tới — FE dùng để suy nút (Admin), BE dùng
// để so khớp tập đích của body.
export function shopTransitionTargets(actor: ShopActorType, from: ShopStatus): ShopStatus[] {
  return SHOP_STATUS_TRANSITIONS.filter((edge) => edge.actor === actor && edge.from === from).map(
    (edge) => edge.to,
  );
}

// Trạng thái shop cho phép chủ shop SỬA thông tin (Week8.md 3C.1): REJECTED (sửa rồi nộp lại) và APPROVED
// (sửa như hiện tại — việc sửa shop đã duyệt phải qua duyệt lại là backlog). PENDING bị khoá (đang chờ
// duyệt, tránh đổi nội dung sau lưng người duyệt) và SUSPENDED bị khoá (tránh đổi thông tin để né lý do
// khoá). Một nguồn duy nhất: BE chặn `PATCH /shops/:id` bằng UPDATE có điều kiện theo tập này, FE dùng
// chính nó để khoá form — không tự suy luật riêng.
export const SHOP_EDITABLE_STATUSES: readonly ShopStatus[] = ['REJECTED', 'APPROVED'];

export function isShopEditable(status: ShopStatus): boolean {
  return SHOP_EDITABLE_STATUSES.includes(status);
}

// Giới hạn độ dài (Week9.md 5.2): các field này đi thẳng vào cột TEXT không giới hạn, nên không chặn ở đây
// thì một body 100KB là một dòng 100KB trong DB (và trong mọi email/trang public hiển thị nó).
// Slug dài hơn tên một chút vì BE nối hậu tố khi trùng (xem ShopService.createWithGeneratedSlug).
export const SHOP_NAME_MAX_LENGTH = 100;
export const SHOP_SLUG_MAX_LENGTH = 150;
export const SHOP_DESCRIPTION_MAX_LENGTH = 2000;
export const SHOP_URL_MAX_LENGTH = 2048;

export const SHOP_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Slug KHÔNG được dùng cho shop: trùng một đoạn đường dẫn cố định dưới `/shops/`. `GET /shops/me` là shop của
// chính user (khai báo trước `GET /shops/:slug`), nên một shop tên "Me" mà lấy slug `me` sẽ không bao giờ mở
// được trang công khai của nó. Tên shop sinh ra slug này được tự đổi sang hậu tố (`me-2`), slug tự nhập thì bị từ chối.
export const SHOP_RESERVED_SLUGS: readonly string[] = ['me'];

const slugSchema = z
  .string()
  .trim()
  .min(1, 'shop.validationSlugRequired')
  .max(SHOP_SLUG_MAX_LENGTH, 'shop.validationSlugTooLong')
  .regex(SHOP_SLUG_PATTERN, 'shop.validationSlugFormat');

// Dùng cho tham số đường dẫn `GET /shops/:slug` (công khai).
export const shopSlugSchema = slugSchema;

// Input HTML bỏ trống gửi lên chuỗi rỗng "" (React Hook Form), không phải
// undefined — coi "" như chưa nhập cho mọi field optional dạng string, để
// payload gửi BE không có field rác (vd description: ""). Dùng .transform()
// ở cuối (không phải z.preprocess ở đầu) để giữ nguyên input type "string |
// undefined" cho zodResolver — z.preprocess nhận input "unknown", làm
// useForm<CreateShopInput>() báo lỗi type không khớp resolver.
const optionalDescriptionSchema = () =>
  z
    .string()
    .trim()
    .max(SHOP_DESCRIPTION_MAX_LENGTH, 'shop.validationDescriptionTooLong')
    .refine(isSafeMultilineText, 'shop.validationDescriptionInvalid')
    .optional()
    .transform((val) => (val === '' ? undefined : val));

// Logo/banner là URL tự do hiển thị công khai ở trang shop (Week9.md 1.10). .url() của Zod nhận MỌI scheme
// (`javascript:`, `data:`, `file:`...), nên phải chốt thêm `https://`: logo/banner thật luôn là link
// Cloudinary (https), còn scheme khác chỉ có nghĩa là tấn công (XSS qua href/img, nội dung hỗn hợp). Không
// import `URL` ở đây vì `lib` của package không có DOM. .url() không chain được sau .optional() nên validate
// bằng .refine() — "" hoặc undefined đều coi là hợp lệ (chưa nhập).
const HTTPS_URL = /^https:\/\//i;
const optionalUrlSchema = (message: string) =>
  z
    .string()
    .trim()
    .max(SHOP_URL_MAX_LENGTH, message)
    .optional()
    .refine((val) => !val || (HTTPS_URL.test(val) && z.string().url().safeParse(val).success), {
      message,
    })
    .transform((val) => (val === '' ? undefined : val));

export const createShopSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'shop.validationNameRequired')
    .max(SHOP_NAME_MAX_LENGTH, 'shop.validationNameTooLong')
    .refine(isSafeName, 'shop.validationNameInvalid'),
  // Bỏ trống thì BE tự sinh slug từ name (xem ShopService.createShop, Week3.md
  // Bước 2.3) — nếu người dùng tự nhập, vẫn phải đúng định dạng slug.
  slug: slugSchema
    .refine((value) => !SHOP_RESERVED_SLUGS.includes(value), 'shop.validationSlugReserved')
    .optional(),
  description: optionalDescriptionSchema(),
  logoUrl: optionalUrlSchema('shop.validationLogoUrlInvalid'),
  bannerUrl: optionalUrlSchema('shop.validationBannerUrlInvalid'),
});
export type CreateShopInput = z.infer<typeof createShopSchema>;

// Không cho sửa slug/status qua endpoint update (xem Week3.md Bước 2.5) — đổi
// slug ảnh hưởng URL công khai, duyệt status là việc của Admin (Tuần 11).
export const updateShopSchema = createShopSchema.omit({ slug: true }).partial();
export type UpdateShopInput = z.infer<typeof updateShopSchema>;

// Body `POST /shops/:shopId/resubmit` (Week8.md 3C.1): dùng lại ĐÚNG schema sửa shop — mọi field tuỳ
// chọn, `{}` hợp lệ (= nộp lại không sửa gì), `status`/`slug` không gửi lên được (z.object tự bỏ).
export const resubmitShopSchema = updateShopSchema;
export type ResubmitShopInput = UpdateShopInput;

// Response đầy đủ 1 Shop — FE dùng để parse() response từ BE.
export const shopSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  description: z.string().nullable(),
  status: shopStatusSchema,
  // Lý do của trạng thái hiện tại do Admin nhập (từ chối hoặc khoá); null khi PENDING/APPROVED.
  statusReason: z.string().nullable(),
  // Mốc đổi trạng thái gần nhất (ISO). Khác updatedAt: updatedAt đổi cả khi chủ shop sửa thông tin.
  statusChangedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shop = z.infer<typeof shopSchema>;

// Response `GET /shops/:slug` (công khai — Week9.md 1.10): chỉ shop APPROVED, KHÔNG có thông tin chủ shop
// (ownerId, email), status hay statusReason. Khác `shopSchema` ở trên (chủ shop/Admin) — tách schema riêng
// thay vì `shopSchema.pick`: hợp đồng công khai là danh sách field khai tường minh, thêm field nội bộ vào Shop
// sau này không tự thành một phần của trang công khai (BE mapper cũng liệt kê tường minh, không spread).
// `avgRating`/`reviewCount` là điểm gộp của các sản phẩm PUBLISHED của shop (BE tính, không có cột trên Shop);
// 0/0 khi chưa có đánh giá nào.
export const publicShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  productCount: z.number().int().nonnegative(),
  avgRating: z.number().min(0).max(5),
  reviewCount: z.number().int().nonnegative(),
});
export type PublicShop = z.infer<typeof publicShopSchema>;
