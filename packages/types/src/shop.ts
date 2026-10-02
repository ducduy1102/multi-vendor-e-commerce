import { z } from 'zod';

export const shopStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export type ShopStatus = z.infer<typeof shopStatusSchema>;

// Bảng chuyển Shop.status hợp lệ do Admin thực hiện (Week8.md 1.8). Chỉ nói cạnh nào hợp lệ về mặt
// trạng thái; thực thi thật nằm ở AdminService (UPDATE có điều kiện WHERE status = <cũ>). REJECTED là
// trạng thái cuối ở Tuần 8 (shop bị từ chối nộp lại là việc sau). Không cạnh nào dẫn về PENDING.
export const SHOP_STATUS_TRANSITIONS: Readonly<Record<ShopStatus, readonly ShopStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  SUSPENDED: ['APPROVED'],
  REJECTED: [],
};

export function isValidShopStatusTransition(from: ShopStatus, to: ShopStatus): boolean {
  return SHOP_STATUS_TRANSITIONS[from].includes(to);
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shop = z.infer<typeof shopSchema>;
