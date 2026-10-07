import { z } from 'zod';
import { checkoutOrderItemSchema } from './checkout';
import { optionalText } from './optional-text';
import { orderActorTypeSchema, orderStatusSchema, type OrderStatus } from './order-status';
import { paymentMethodSchema, paymentStatusSchema } from './payment';

// Số tiền VND luôn là chuỗi số nguyên đồng trong RESPONSE (cùng quy ước CartView/CheckoutGroup).
const moneySchema = z.string();

// --- Tab trạng thái (Week8.md 1.11) ------------------------------------------------------------
// Định nghĩa 1 lần ở đây cho cả FE (hiển thị tab) lẫn BE (lọc theo tab). Tab là NHÓM trạng thái,
// không phải 1 status — vì vậy query param tên `tab`, không phải `status`.
export const orderTabSchema = z.enum([
  'awaiting-payment',
  'pending',
  'processing',
  'shipping',
  'completed',
  'cancelled',
]);
export type OrderTab = z.infer<typeof orderTabSchema>;

// Mỗi OrderStatus thuộc ĐÚNG 1 tab (có test khẳng định phân hoạch đầy đủ, không sót/không trùng).
export const ORDER_TAB_STATUSES: Readonly<Record<OrderTab, readonly OrderStatus[]>> = {
  'awaiting-payment': ['AWAITING_PAYMENT'],
  pending: ['PENDING'],
  processing: ['CONFIRMED', 'PACKED'],
  shipping: ['SHIPPING'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED', 'REFUNDED'],
};

// Seller KHÔNG có tab "chờ thanh toán": đơn chưa trả tiền không được lộ cho Seller (Week7.md 1.13).
// Loại ở mức kiểu để `?tab=awaiting-payment` bị từ chối ngay ở validate, không chỉ ở service.
export const sellerOrderTabSchema = orderTabSchema.exclude(['awaiting-payment']);
export type SellerOrderTab = z.infer<typeof sellerOrderTabSchema>;

// --- Query danh sách ---------------------------------------------------------------------------
// Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2).
const paginationShape = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
};

export const orderListQuerySchema = z.object({
  tab: orderTabSchema.optional(),
  ...paginationShape,
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const sellerOrderListQuerySchema = z.object({
  tab: sellerOrderTabSchema.optional(),
  ...paginationShape,
});
export type SellerOrderListQuery = z.infer<typeof sellerOrderListQuerySchema>;

// --- Phần dùng chung giữa buyer và seller ------------------------------------------------------

// Số dòng hàng tối đa trả kèm mỗi đơn ở danh sách (đủ hiển thị card gọn); chi tiết trả đủ.
export const ORDER_LIST_PREVIEW_ITEMS = 3;

export const orderShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
});
export type OrderShop = z.infer<typeof orderShopSchema>;

export const orderHistoryEntrySchema = z.object({
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema,
  actorType: orderActorTypeSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type OrderHistoryEntry = z.infer<typeof orderHistoryEntrySchema>;

// --- Buyer: GET /orders, GET /orders/:id -------------------------------------------------------
// Các cờ `can*` do BE tính (theo status + phương thức thanh toán) — FE chỉ hiển thị nút theo cờ,
// không tự suy luật (đổi chính sách hủy đơn ở Tuần 9 không phải sửa FE).
export const orderListItemSchema = z.object({
  id: z.string(),
  checkoutGroupId: z.string(),
  status: orderStatusSchema,
  createdAt: z.string(),
  totalAmount: moneySchema,
  shop: orderShopSchema,
  // Tối đa ORDER_LIST_PREVIEW_ITEMS dòng đầu; `itemCount` là tổng số dòng hàng của đơn.
  items: z.array(checkoutOrderItemSchema),
  itemCount: z.number().int().nonnegative(),
  // Thanh toán gắn theo NHÓM (1 Payment cho N đơn) — đây là lần thử mới nhất của nhóm.
  paymentMethod: paymentMethodSchema.nullable(),
  paymentStatus: paymentStatusSchema.nullable(),
  canCancel: z.boolean(),
  canConfirmReceived: z.boolean(),
  canRetryPayment: z.boolean(),
});
export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderListResponseSchema = z.object({
  items: z.array(orderListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

// Chi tiết: snapshot địa chỉ + dòng hàng LÚC ĐẶT (không đổi khi Seller/user sửa sau đó) và timeline.
export const orderDetailSchema = orderListItemSchema.extend({
  items: z.array(checkoutOrderItemSchema),
  recipientName: z.string(),
  recipientPhone: z.string(),
  shippingAddressLine: z.string(),
  shippingWard: z.string(),
  shippingProvince: z.string(),
  subtotal: moneySchema,
  discountAmount: moneySchema,
  shippingFee: moneySchema,
  carrier: z.string().nullable(),
  trackingCode: z.string().nullable(),
  // Lời nhắn người mua đã gửi cho shop này lúc đặt (Week8.md 3B); null = không để lại lời nhắn.
  // Chỉ ở chi tiết — danh sách đơn của người mua không cần.
  buyerNote: z.string().nullable(),
  // Cũ → mới; dòng đầu có fromStatus = null (mốc tạo đơn).
  history: z.array(orderHistoryEntrySchema),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

// --- Seller: GET /shops/:shopId/orders[/:orderId] ----------------------------------------------
// Chỉ lộ thông tin NGƯỜI NHẬN (snapshot trên đơn), không `userId`/email của buyer.
export const sellerOrderListItemSchema = z.object({
  id: z.string(),
  status: orderStatusSchema,
  createdAt: z.string(),
  totalAmount: moneySchema,
  recipientName: z.string(),
  shippingProvince: z.string(),
  // Lời nhắn của người mua cho shop (Week8.md 3B) — chỉ lời nhắn của ĐƠN NÀY; card ở danh sách chỉ
  // hiện tối đa 2 dòng nhưng BE trả đủ (≤ 500 ký tự), cắt dòng là việc của CSS.
  buyerNote: z.string().nullable(),
  items: z.array(checkoutOrderItemSchema),
  itemCount: z.number().int().nonnegative(),
  paymentMethod: paymentMethodSchema.nullable(),
  paymentStatus: paymentStatusSchema.nullable(),
  canConfirm: z.boolean(),
  canPack: z.boolean(),
  canShip: z.boolean(),
  canReject: z.boolean(),
});
export type SellerOrderListItem = z.infer<typeof sellerOrderListItemSchema>;

export const sellerOrderListResponseSchema = z.object({
  items: z.array(sellerOrderListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type SellerOrderListResponse = z.infer<typeof sellerOrderListResponseSchema>;

export const sellerOrderDetailSchema = sellerOrderListItemSchema.extend({
  items: z.array(checkoutOrderItemSchema),
  recipientPhone: z.string(),
  shippingAddressLine: z.string(),
  shippingWard: z.string(),
  subtotal: moneySchema,
  discountAmount: moneySchema,
  shippingFee: moneySchema,
  carrier: z.string().nullable(),
  trackingCode: z.string().nullable(),
  history: z.array(orderHistoryEntrySchema),
});
export type SellerOrderDetail = z.infer<typeof sellerOrderDetailSchema>;

// --- Body của các hành động --------------------------------------------------------------------

export const ORDER_REASON_MAX_LENGTH = 500;
export const ORDER_SHIPPING_FIELD_MAX_LENGTH = 100;

// POST /orders/:id/cancel — lý do tuỳ chọn.
export const cancelOrderSchema = z.object({
  reason: optionalText(ORDER_REASON_MAX_LENGTH, 'order.validationReasonTooLong'),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// POST /shops/:shopId/orders/:orderId/reject — Seller từ chối đơn COD, lý do BẮT BUỘC.
export const rejectOrderSchema = z.object({
  reason: z
    .string({ required_error: 'order.validationReasonRequired' })
    .trim()
    .min(1, 'order.validationReasonRequired')
    .max(ORDER_REASON_MAX_LENGTH, 'order.validationReasonTooLong'),
});
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;

// POST /shops/:shopId/orders/:orderId/ship — thông tin vận chuyển nhập tay, cả 2 tuỳ chọn.
export const shipOrderSchema = z.object({
  carrier: optionalText(ORDER_SHIPPING_FIELD_MAX_LENGTH, 'order.validationCarrierTooLong'),
  trackingCode: optionalText(
    ORDER_SHIPPING_FIELD_MAX_LENGTH,
    'order.validationTrackingCodeTooLong',
  ),
});
export type ShipOrderInput = z.infer<typeof shipOrderSchema>;
