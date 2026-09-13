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

export const createShopSchema = z.object({
  name: z.string().trim().min(1, 'Tên shop không được để trống'),
  // Bỏ trống thì BE tự sinh slug từ name (xem ShopService.createShop, Week3.md
  // Bước 2.3) — nếu người dùng tự nhập, vẫn phải đúng định dạng slug.
  slug: slugSchema.optional(),
  description: z.string().trim().optional(),
  logoUrl: z.string().trim().url('URL logo không hợp lệ').optional(),
  bannerUrl: z.string().trim().url('URL banner không hợp lệ').optional(),
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
