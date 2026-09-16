import { z } from 'zod';

// Category chưa có module/CRUD riêng (Admin category management để dành Tuần
// 11, xem Week4.md Bước 1.3) — schema này chỉ phục vụ đọc (GET /categories,
// apps/api/src/modules/product/product.controller.ts).
export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;
