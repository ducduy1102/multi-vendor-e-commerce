import { z } from 'zod';

// Số tiền VND luôn là chuỗi số nguyên đồng (vd "150000") — cùng quy ước với
// minPrice/maxPrice của product (Prisma Decimal serialize ra string), FE đưa
// thẳng vào formatPrice của modules/product.
const moneySchema = z.string();

// 1 dòng giỏ do client gửi lên (guest quote/merge, thêm vào giỏ). Giá/tên/tồn
// kho KHÔNG nhận từ client — luôn đọc live từ DB (Week6.md 1.2/1.7).
export const cartItemInputSchema = z.object({
  productVariantId: z.string().min(1),
  quantity: z.number().int().min(1, 'cart.validationQuantityMin'),
});
export type CartItemInput = z.infer<typeof cartItemInputSchema>;

// Body của POST /cart/merge (đã đăng nhập, gộp giỏ guest vào DB).
export const cartItemsBodySchema = z.object({
  items: z.array(cartItemInputSchema).max(100),
});
export type CartItemsBody = z.infer<typeof cartItemsBodySchema>;

// Mã voucher tuỳ chọn (Week6.md 1.12: đúng 1 mã/lần). Chuỗi rỗng/khoảng trắng
// hợp lệ và coi như không có mã — BE bỏ qua thay vì 400, vì ô nhập bỏ trống
// gửi lên "" chứ không phải undefined.
export const optionalVoucherCodeSchema = z.string().trim().max(32).optional();

// Body của POST /cart/quote (public, guest): items lấy từ localStorage.
export const cartQuoteBodySchema = cartItemsBodySchema.extend({
  voucherCode: optionalVoucherCodeSchema,
});
export type CartQuoteBody = z.infer<typeof cartQuoteBodySchema>;

// Query của GET /cart (đã đăng nhập): ?voucherCode=...
export const cartQuerySchema = z.object({
  voucherCode: optionalVoucherCodeSchema,
});
export type CartQuery = z.infer<typeof cartQuerySchema>;

// POST /cart/items — thêm (cộng dồn) 1 variant vào giỏ.
export const addCartItemSchema = cartItemInputSchema;
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

// PATCH /cart/items/:itemId — đặt số lượng mới (không phải cộng dồn); muốn
// bỏ item thì dùng DELETE, không dùng quantity 0.
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1, 'cart.validationQuantityMin'),
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

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
  // Chỉ có khi sản phẩm vẫn đang bán nhưng là của CHÍNH shop người xem (người bán không được tự mua): dòng bị
  // loại như dòng không khả dụng, FE dùng để hiện đúng lý do. Giỏ guest (không biết người xem là ai) và dòng
  // không khả dụng vì lý do khác không bao giờ có field này.
  unavailableReason: z.literal('OWN_SHOP').optional(),
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
  // Số DÒNG (sản phẩm/variant khác nhau) trong giỏ, kể cả dòng không khả dụng —
  // cho badge giỏ hàng. Không phải tổng số lượng: 1 sản phẩm x16 vẫn là 1.
  itemCount: z.number().int(),
});
export type CartView = z.infer<typeof cartViewSchema>;

// Response của GET /cart, POST /cart/quote, POST /cart/merge — cùng bọc
// { cart } để FE parse 1 schema duy nhất cho mọi nhánh (Week6.md 1.7).
export const cartResponseSchema = z.object({ cart: cartViewSchema });
export type CartResponse = z.infer<typeof cartResponseSchema>;

// Dòng giỏ thô trả về sau POST /cart/items và PATCH /cart/items/:itemId.
export const cartItemRowSchema = z.object({
  id: z.string(),
  productVariantId: z.string(),
  quantity: z.number().int(),
});
export type CartItemRow = z.infer<typeof cartItemRowSchema>;

export const cartItemResponseSchema = z.object({ item: cartItemRowSchema });
export type CartItemResponse = z.infer<typeof cartItemResponseSchema>;

// Trần số DÒNG (variant khác nhau) trong 1 giỏ. Checkout thanh toán cả giỏ trong
// 1 transaction (chưa có ô chọn sản phẩm — Week7.md 1.12) nên giỏ dài vô hạn sẽ thành
// 1 giao dịch khổng lồ. Cộng dồn số lượng vào dòng có sẵn không bị giới hạn bởi trần này.
export const MAX_CART_LINES = 50;

// Response của POST /cart/merge: giỏ mới kèm số dòng của giỏ guest bị bỏ vì giỏ đã đủ
// MAX_CART_LINES (dòng không khả dụng/hết hàng bị bỏ thầm lặng thì KHÔNG tính vào đây).
export const mergeCartResponseSchema = cartResponseSchema.extend({
  droppedLineCount: z.number().int().nonnegative(),
});
export type MergeCartResponse = z.infer<typeof mergeCartResponseSchema>;
