import { z } from 'zod';

// Số tiền VND luôn là chuỗi số nguyên đồng (vd "150000") — cùng quy ước với
// minPrice/maxPrice của product (Prisma Decimal serialize ra string), FE đưa
// thẳng vào formatPrice của modules/product.
const moneySchema = z.string();

// 1 dòng giỏ do client gửi lên (guest quote/merge, thêm vào giỏ). Giá/tên/tồn
// kho KHÔNG nhận từ client — luôn đọc live từ DB (Week6.md 1.2/1.7).
export const cartItemInputSchema = z.object({
  productVariantId: z.string().min(1),
  quantity: z.number().int().min(1, 'Số lượng tối thiểu là 1'),
});
export type CartItemInput = z.infer<typeof cartItemInputSchema>;

// Body của POST /cart/quote (guest) và POST /cart/merge (đã đăng nhập).
export const cartItemsBodySchema = z.object({
  items: z.array(cartItemInputSchema).max(100),
});
export type CartItemsBody = z.infer<typeof cartItemsBodySchema>;

export const cartLineSchema = z.object({
  // id của CartItem trong DB — chỉ có với user đã đăng nhập (FE cần để gọi
  // PATCH/DELETE /cart/items/:itemId), guest luôn null.
  id: z.string().nullable(),
  productVariantId: z.string(),
  quantity: z.number().int(),
  productId: z.string(),
  productName: z.string(),
  productSlug: z.string(),
  imageUrl: z.string().nullable(),
  // Các thuộc tính đã chọn của variant, vd [{name: 'Màu', value: 'Đỏ'}].
  attributes: z.array(z.object({ name: z.string(), value: z.string() })),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  stock: z.number().int(),
  // Week6.md 1.9: item không khả dụng vẫn nằm trong giỏ nhưng bị loại khỏi
  // mọi tổng tiền.
  isAvailable: z.boolean(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartShopGroupSchema = z.object({
  shopId: z.string(),
  shopName: z.string(),
  shopSlug: z.string(),
  items: z.array(cartLineSchema),
  // Chỉ cộng các item isAvailable.
  subtotal: moneySchema,
});
export type CartShopGroup = z.infer<typeof cartShopGroupSchema>;

// Voucher đã áp (Week6.md 1.11/1.12: đúng 1 mã, shopId null = toàn sàn).
export const cartDiscountSchema = z.object({
  code: z.string(),
  shopId: z.string().nullable(),
  amount: moneySchema,
});
export type CartDiscount = z.infer<typeof cartDiscountSchema>;

// Shape duy nhất cho cả guest lẫn user đăng nhập (Week6.md 1.7).
export const cartViewSchema = z.object({
  shops: z.array(cartShopGroupSchema),
  // Tổng các subtotal shop (trước giảm giá).
  subtotal: moneySchema,
  discount: cartDiscountSchema.nullable(),
  grandTotal: moneySchema,
  // Tổng quantity của mọi dòng (kể cả không khả dụng) — cho badge giỏ hàng.
  itemCount: z.number().int(),
});
export type CartView = z.infer<typeof cartViewSchema>;
