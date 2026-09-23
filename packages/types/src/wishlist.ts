import { z } from 'zod';
import { productCardSchema } from './product';

// GET /wishlist (Week5.md Bước 1.17/2.6) — tái dùng nguyên productCardSchema
// (không tự tạo shape mới), chỉ thêm isAvailable: sản phẩm/shop bị archive/
// suspend sau khi đã wishlist thì vẫn giữ trong danh sách (không tự xoá),
// FE dùng field này để hiện badge "Ngừng bán" thay vì ẩn hẳn.
export const wishlistItemSchema = productCardSchema.extend({
  isAvailable: z.boolean(),
});
export type WishlistItem = z.infer<typeof wishlistItemSchema>;

// GET /wishlist — không phân trang (chưa có nhu cầu ở MVP, danh sách cá nhân
// nhỏ, giống getMyProducts của seller).
export const wishlistListResponseSchema = z.object({
  items: z.array(wishlistItemSchema),
});
export type WishlistListResponse = z.infer<typeof wishlistListResponseSchema>;

// Response chung cho POST/DELETE /wishlist/:productId và
// GET /wishlist/:productId/status (Week5.md Bước 1.18/2.7) — cùng 1 shape để
// FE đồng bộ lại state từ bất kỳ 3 API nào cũng được, không cần phân biệt.
export const wishlistStatusSchema = z.object({
  isWishlisted: z.boolean(),
});
export type WishlistStatus = z.infer<typeof wishlistStatusSchema>;
