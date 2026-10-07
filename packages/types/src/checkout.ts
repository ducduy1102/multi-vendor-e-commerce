import { z } from 'zod';
import { cartDiscountSchema, cartLineSchema, optionalVoucherCodeSchema } from './cart';
import { orderStatusSchema } from './order-status';
import {
  paymentMethodAvailabilitySchema,
  paymentMethodSchema,
  paymentStatusSchema,
} from './payment';

// Số tiền VND luôn là chuỗi số nguyên đồng trong RESPONSE (cùng quy ước CartView); trong REQUEST
// (expectedTotal) là số nguyên.
const moneySchema = z.string();

// Header `Idempotency-Key` của POST /checkout (Week7.md 1.11): UUID do FE sinh mỗi phiên đặt hàng.
// Gọi lại cùng key trả đúng nhóm đã tạo thay vì đặt trùng.
export const idempotencyKeySchema = z.string().uuid('checkout.validationIdempotencyKeyInvalid');

// Lời nhắn của người mua cho 1 shop (Week8.md 3B): văn bản thuần, tối đa 500 ký tự. Dùng chung độ
// dài cho cột `orders.buyer_note` (VARCHAR(500)) và ô nhập ở /checkout.
export const ORDER_NOTE_MAX_LENGTH = 500;

// Giỏ nhiều shop ⇒ mỗi đơn một lời nhắn riêng, khoá là `shopId` (lời nhắn gửi shop A không lộ cho shop B).
// `.trim()` TRƯỚC `.max()` nên 500 ký tự + khoảng trắng thừa vẫn hợp lệ. Mục rỗng/toàn khoảng trắng bị
// bỏ khỏi map ở CUỐI chain (`transform`, cùng cách `shop.ts`) — "không có lời nhắn" không phải 1 giá trị
// để lưu — và map rỗng ⇒ `undefined`. `shopId` không có trong giỏ lúc đặt KHÔNG bị lỗi: service bỏ qua
// (lời nhắn không quan trọng bằng việc đặt được hàng khi giỏ vừa đổi giữa lúc xem trước và lúc đặt).
const shopNotesSchema = z
  .record(
    z.string(),
    z.string().trim().max(ORDER_NOTE_MAX_LENGTH, 'checkout.validationNoteTooLong'),
  )
  .optional()
  .transform((notes) => {
    if (!notes) return undefined;
    const kept = Object.entries(notes).filter(([, note]) => note !== '');
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
  });

// POST /checkout. userId luôn lấy từ token; địa chỉ phải thuộc user (service kiểm, không thuộc ⇒ 404).
// `expectedTotal` BẮT BUỘC: là `grandTotal` của lần xem trước — thiếu ⇒ 400 để 1 client quên gửi
// không làm mất bảo vệ "số thấy = số trả"; BE tính lại từ giá đã khoá, lệch ⇒ 409 PRICE_CHANGED.
export const placeOrderSchema = z.object({
  addressId: z
    .string({ required_error: 'checkout.validationAddressRequired' })
    .min(1, 'checkout.validationAddressRequired'),
  paymentMethod: paymentMethodSchema,
  voucherCode: optionalVoucherCodeSchema,
  expectedTotal: z
    .number({
      required_error: 'checkout.validationExpectedTotalInvalid',
      invalid_type_error: 'checkout.validationExpectedTotalInvalid',
    })
    .int('checkout.validationExpectedTotalInvalid')
    .nonnegative('checkout.validationExpectedTotalInvalid'),
  shopNotes: shopNotesSchema,
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

// POST /checkout/preview — chưa chọn địa chỉ thì không đoán phí ship (needsAddress).
export const previewCheckoutSchema = z.object({
  addressId: z.string().min(1, 'checkout.validationAddressRequired').optional(),
  voucherCode: optionalVoucherCodeSchema,
});
export type PreviewCheckoutInput = z.infer<typeof previewCheckoutSchema>;

// --- Xem trước ---------------------------------------------------------------------------

// 1 shop = 1 Order tương lai. Phí ship/tổng là null khi chưa có địa chỉ.
export const checkoutPreviewOrderSchema = z.object({
  shopId: z.string(),
  shopName: z.string(),
  shopSlug: z.string(),
  items: z.array(cartLineSchema),
  subtotal: moneySchema,
  shippingFee: moneySchema.nullable(),
  // Phần chia của voucher toàn sàn cho đơn này (largest remainder, 1.6); voucher shop chỉ vào đơn của shop đó.
  discountAmount: moneySchema,
  total: moneySchema.nullable(),
});
export type CheckoutPreviewOrder = z.infer<typeof checkoutPreviewOrderSchema>;

// Dòng không khả dụng: không được thanh toán và vẫn ở trong giỏ.
export const excludedItemSchema = z.object({
  cartItemId: z.string(),
  name: z.string(),
  reason: z.literal('UNAVAILABLE'),
});
export type ExcludedItem = z.infer<typeof excludedItemSchema>;

// Dòng chặn đặt hàng: quantity > available (không tự hạ số lượng — chặn và báo, 1.12).
export const blockingIssueSchema = z.object({
  cartItemId: z.string(),
  type: z.literal('INSUFFICIENT_STOCK'),
  available: z.number().int().nonnegative(),
});
export type BlockingIssue = z.infer<typeof blockingIssueSchema>;

export const checkoutPreviewSchema = z.object({
  orders: z.array(checkoutPreviewOrderSchema),
  subtotal: moneySchema,
  shippingTotal: moneySchema.nullable(),
  discountTotal: moneySchema,
  // FE gửi lại đúng giá trị này làm `expectedTotal` khi đặt hàng.
  grandTotal: moneySchema.nullable(),
  discount: cartDiscountSchema.nullable(),
  needsAddress: z.boolean(),
  paymentMethods: z.array(paymentMethodAvailabilitySchema),
  excludedItems: z.array(excludedItemSchema),
  blockingIssues: z.array(blockingIssueSchema),
  canPlaceOrder: z.boolean(),
});
export type CheckoutPreview = z.infer<typeof checkoutPreviewSchema>;

// --- Nhóm thanh toán ---------------------------------------------------------------------

// Trạng thái nhóm KHÔNG lưu cột riêng mà suy ra từ đơn + lần thử thanh toán (Week7.md 1.13):
//  PAID: đơn đã PENDING trở đi và có Payment SUCCESS
//  AWAITING_PAYMENT: đơn chờ thanh toán, lần thử mới nhất PENDING chưa hết hạn
//  PAYMENT_FAILED: lần thử mới nhất bị từ chối, còn trong hạn giữ chỗ (canRetry)
//  PAYMENT_EXPIRED: lần thử mới nhất quá hạn nhưng chưa thu hồi (chưa cho thử lại)
//  CANCELLED: mọi đơn đã huỷ, không có Payment SUCCESS
//  PAID_AFTER_EXPIRY: có Payment SUCCESS nhưng mọi đơn đã huỷ (thanh toán muộn, chờ hoàn tiền Tuần 9)
//  COD_PLACED: đơn COD đã đặt thành công, còn đơn đang hoạt động — CHƯA thu tiền (Week8.md 1.6);
//    FE KHÔNG được hiển thị là "đã thanh toán"
export const checkoutGroupStatusSchema = z.enum([
  'PAID',
  'AWAITING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'CANCELLED',
  'PAID_AFTER_EXPIRY',
  'COD_PLACED',
]);
export type CheckoutGroupStatus = z.infer<typeof checkoutGroupStatusSchema>;

// Snapshot dòng hàng lúc mua — không đổi khi Seller sửa sản phẩm sau đó.
export const checkoutOrderItemSchema = z.object({
  productName: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string(),
  imageUrl: z.string().nullable(),
  quantity: z.number().int(),
  priceAtPurchase: moneySchema,
});
export type CheckoutOrderItem = z.infer<typeof checkoutOrderItemSchema>;

export const checkoutOrderSchema = z.object({
  id: z.string(),
  shopId: z.string(),
  shopName: z.string(),
  status: orderStatusSchema,
  subtotal: moneySchema,
  discountAmount: moneySchema,
  shippingFee: moneySchema,
  totalAmount: moneySchema,
  items: z.array(checkoutOrderItemSchema),
});
export type CheckoutOrder = z.infer<typeof checkoutOrderSchema>;

// GET /checkout/groups/:groupId — chỉ chủ nhóm xem được. FE hiển thị theo `status` BE trả về,
// KHÔNG đọc query của cổng thanh toán để kết luận.
export const checkoutGroupSchema = z.object({
  id: z.string(),
  status: checkoutGroupStatusSchema,
  // Có được bấm "thanh toán lại" (POST /checkout/groups/:groupId/pay) không.
  canRetry: z.boolean(),
  // Hạn của lần thử thanh toán mới nhất; null nếu chưa từng có lần thử.
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  totalAmount: moneySchema,
  paymentMethod: paymentMethodSchema.nullable(),
  latestPaymentStatus: paymentStatusSchema.nullable(),
  orders: z.array(checkoutOrderSchema),
});
export type CheckoutGroup = z.infer<typeof checkoutGroupSchema>;

// Kết quả POST /checkout (và phát lại theo Idempotency-Key). `paymentUrl` null khi gọi cổng lỗi
// sau khi đã ghi đơn — đơn vẫn AWAITING_PAYMENT và người dùng bấm thanh toán lại được.
export const checkoutResultSchema = z.object({
  checkoutGroupId: z.string(),
  orders: z.array(
    z.object({
      id: z.string(),
      shopId: z.string(),
      status: orderStatusSchema,
      totalAmount: moneySchema,
    }),
  ),
  totalAmount: moneySchema,
  paymentMethod: paymentMethodSchema,
  // null với đơn COD (không có hạn thanh toán, Week8.md 1.6).
  expiresAt: z.string().nullable(),
  // null khi gọi cổng lỗi sau khi đã ghi đơn, hoặc với đơn COD (không có cổng).
  paymentUrl: z.string().nullable(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

// Kết quả POST /checkout/groups/:groupId/pay: URL thanh toán (mới hoặc đã lưu) và hạn của nó.
export const payAttemptResultSchema = z.object({
  paymentUrl: z.string(),
  expiresAt: z.string(),
});
export type PayAttemptResult = z.infer<typeof payAttemptResultSchema>;
