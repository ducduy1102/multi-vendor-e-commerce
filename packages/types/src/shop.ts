import { z } from 'zod';

export const shopStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export type ShopStatus = z.infer<typeof shopStatusSchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug không được để trống')
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Slug chỉ gồm chữ thường, số và dấu gạch ngang',
  );

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
  name: z.string().trim().min(1, 'Tên shop không được để trống'),
  // Bỏ trống thì BE tự sinh slug từ name (xem ShopService.createShop, Week3.md
  // Bước 2.3) — nếu người dùng tự nhập, vẫn phải đúng định dạng slug.
  slug: slugSchema.optional(),
  description: optionalTrimmedString(),
  logoUrl: optionalUrlSchema('URL logo không hợp lệ'),
  bannerUrl: optionalUrlSchema('URL banner không hợp lệ'),
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shop = z.infer<typeof shopSchema>;
