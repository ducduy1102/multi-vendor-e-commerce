import { z } from 'zod';

export const shopStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export type ShopStatus = z.infer<typeof shopStatusSchema>;

// Ai thực hiện 1 lần chuyển trạng thái shop (ShopStatusHistory.actorType) — khớp enum Prisma
// ShopActorType (test parity ở BE). SYSTEM chưa có cạnh nào trong bảng bên dưới (dành cho backfill và
// các chuyển trạng thái hệ thống sau này, vd khoá user ⇒ tự khoá shop).
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
// Chủ shop không bao giờ tự APPROVED; Admin không thực hiện được cạnh của Owner (và ngược lại). Chỉ nói
// cạnh nào hợp lệ + ai làm được; thực thi thật nằm ở ShopStatusService (UPDATE có điều kiện WHERE
// status = <cũ>). Cố ý KHÔNG có hàm "cạnh này có tồn tại với bất kỳ ai không" — kiểm cạnh mà không
// kèm actor là cách để AdminService vô tình cho phép cạnh của Owner.
export const SHOP_STATUS_TRANSITIONS: readonly ShopStatusTransition[] = [
  { from: 'PENDING', to: 'APPROVED', actor: 'ADMIN' },
  { from: 'PENDING', to: 'REJECTED', actor: 'ADMIN' },
  { from: 'REJECTED', to: 'PENDING', actor: 'OWNER' },
  { from: 'APPROVED', to: 'SUSPENDED', actor: 'ADMIN' },
  { from: 'SUSPENDED', to: 'APPROVED', actor: 'ADMIN' },
];

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

const slugSchema = z
  .string()
  .trim()
  .min(1, 'shop.validationSlugRequired')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'shop.validationSlugFormat');

// Input HTML bỏ trống gửi lên chuỗi rỗng "" (React Hook Form), không phải
// undefined — coi "" như chưa nhập cho mọi field optional dạng string, để
// payload gửi BE không có field rác (vd description: ""). Dùng .transform()
// ở cuối (không phải z.preprocess ở đầu) để giữ nguyên input type "string |
// undefined" cho zodResolver — z.preprocess nhận input "unknown", làm
// useForm<CreateShopInput>() báo lỗi type không khớp resolver.
const optionalTrimmedString = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((val) => (val === '' ? undefined : val));

// .url() không chain được sau .optional() nên validate URL bằng .refine()
// (tái dùng z.string().url() nội bộ, không tự viết lại regex) — "" hoặc
// undefined đều coi là hợp lệ (chưa nhập), y hệt .url() sẽ từ chối "" nếu
// chain trực tiếp dù field optional.
const optionalUrlSchema = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message,
    })
    .transform((val) => (val === '' ? undefined : val));

export const createShopSchema = z.object({
  name: z.string().trim().min(1, 'shop.validationNameRequired'),
  // Bỏ trống thì BE tự sinh slug từ name (xem ShopService.createShop, Week3.md
  // Bước 2.3) — nếu người dùng tự nhập, vẫn phải đúng định dạng slug.
  slug: slugSchema.optional(),
  description: optionalTrimmedString(),
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
