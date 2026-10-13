import { z } from 'zod';
import { checkoutOrderItemSchema } from './checkout';
import { optionalText } from './optional-text';
import { orderActorTypeSchema, orderStatusSchema } from './order-status';
import { paymentMethodSchema, paymentStatusSchema } from './payment';
import {
  orderRefundSummarySchema,
  paymentRefundStatusSchema,
  refundRequestHistoryItemSchema,
  refundRequestKindSchema,
  refundRequestStatusSchema,
  REFUND_NOTE_MAX_LENGTH,
} from './refund';

// Khu Admin xử lý tiền hoàn (Week9.md 1.9, 2.9): hàng chờ khiếu nại, hoàn tiền lỗi/đang chờ, thanh toán bất
// thường. Mọi route chỉ ADMIN gọi được nên các response ở đây được phép kèm email người mua và mã giao dịch
// cổng (Admin cần để đối chiếu/hoàn thủ công trên trang merchant của cổng) — KHÔNG dùng lại cho buyer/seller.

// Số tiền VND luôn là chuỗi số nguyên đồng trong RESPONSE (cùng quy ước order.ts/checkout.ts).
const moneySchema = z.string();

// Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2).
const paginationShape = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
};

const adminBuyerSchema = z.object({
  name: z.string(),
  email: z.string(),
});

// --- Hàng chờ yêu cầu hủy/trả hàng: GET /admin/refund-requests ---------------------------------------

// Mặc định là hàng chờ KHIẾU NẠI (ESCALATED). Admin xem được mọi trạng thái (kể cả đã rút) — khác seller.
export const adminRefundRequestListQuerySchema = z.object({
  status: refundRequestStatusSchema.default('ESCALATED'),
  ...paginationShape,
});
export type AdminRefundRequestListQuery = z.infer<typeof adminRefundRequestListQuerySchema>;

// Yêu cầu đầy đủ + tóm tắt đơn vừa đủ để quyết định (người mua, shop, hàng, tiền, cách thanh toán, khoản hoàn
// đã tạo nếu có). Cờ canApprove/canReject do BE tính từ bảng chuyển CÓ ACTOR (actor ADMIN) — FE không tự suy.
export const adminRefundRequestSchema = z.object({
  id: z.string(),
  kind: refundRequestKindSchema,
  status: refundRequestStatusSchema,
  reasonCode: z.string(),
  reasonNote: z.string().nullable(),
  // Hạn seller phản hồi (ISO); lúc ESCALATED, `statusChangedAt` là lúc được chuyển lên sàn (hàng chờ xếp theo đó).
  sellerRespondBy: z.string(),
  statusChangedAt: z.string(),
  createdAt: z.string(),
  history: z.array(refundRequestHistoryItemSchema),
  canApprove: z.boolean(),
  canReject: z.boolean(),
  shop: z.object({ id: z.string(), name: z.string() }),
  buyer: adminBuyerSchema,
  order: z.object({
    id: z.string(),
    status: orderStatusSchema,
    totalAmount: moneySchema,
    recipientName: z.string(),
    items: z.array(checkoutOrderItemSchema),
    itemCount: z.number().int().nonnegative(),
    paymentMethod: paymentMethodSchema.nullable(),
    paymentStatus: paymentStatusSchema.nullable(),
    refund: orderRefundSummarySchema.nullable(),
  }),
});
export type AdminRefundRequest = z.infer<typeof adminRefundRequestSchema>;

export const adminRefundRequestListResponseSchema = z.object({
  items: z.array(adminRefundRequestSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminRefundRequestListResponse = z.infer<typeof adminRefundRequestListResponseSchema>;

// --- Sổ cái hoàn tiền: GET /admin/refunds ------------------------------------------------------------

// NEEDS_ACTION (mặc định) = FAILED + PENDING bị bỏ dở quá REFUND_PENDING_STALE_MS (5 phút) — đúng tập Admin được
// thử lại/ghi nhận thủ công. PENDING = mọi khoản đang chờ (kể cả lần gọi cổng còn đang chạy); FAILED; SUCCEEDED
// = lịch sử đã hoàn.
export const adminRefundListFilterSchema = z.enum([
  'NEEDS_ACTION',
  'PENDING',
  'FAILED',
  'SUCCEEDED',
]);
export type AdminRefundListFilter = z.infer<typeof adminRefundListFilterSchema>;

export const adminRefundListQuerySchema = z.object({
  status: adminRefundListFilterSchema.default('NEEDS_ACTION'),
  ...paginationShape,
});
export type AdminRefundListQuery = z.infer<typeof adminRefundListQuerySchema>;

export const adminRefundSchema = z.object({
  id: z.string(),
  status: paymentRefundStatusSchema,
  amount: moneySchema,
  // Số lần đã gọi cổng (tính cả lần ngay trong request tạo ra khoản hoàn).
  attempts: z.number().int().nonnegative(),
  // Lý do hoàn (do người quyết định nhập) và lý do LỖI nội bộ của cổng — chỉ Admin thấy.
  reason: z.string().nullable(),
  failureReason: z.string().nullable(),
  // Mã hoàn do cổng trả; hoàn thủ công ghi 'MANUAL:<mã tham chiếu>'.
  gatewayRef: z.string().nullable(),
  initiatedByType: orderActorTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  // Do BE tính từ cùng điều kiện mà retry / mark-completed kiểm lại khi thực thi (FAILED, hoặc PENDING quá 5 phút).
  canRetry: z.boolean(),
  canMarkCompleted: z.boolean(),
  payment: z.object({
    id: z.string(),
    method: paymentMethodSchema,
    status: paymentStatusSchema,
    amount: moneySchema,
    refundedAmount: moneySchema,
    // Hai mã để tìm giao dịch trên trang merchant của cổng khi hoàn thủ công.
    txnRef: z.string(),
    transactionId: z.string().nullable(),
  }),
  // null = hoàn thanh toán bất thường, không gắn đơn nào.
  order: z
    .object({
      id: z.string(),
      status: orderStatusSchema,
      totalAmount: moneySchema,
      recipientName: z.string(),
    })
    .nullable(),
  buyer: adminBuyerSchema,
});
export type AdminRefund = z.infer<typeof adminRefundSchema>;

export const adminRefundListResponseSchema = z.object({
  items: z.array(adminRefundSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminRefundListResponse = z.infer<typeof adminRefundListResponseSchema>;

export const ADMIN_REFUND_REFERENCE_MAX_LENGTH = 100;

// POST /admin/refunds/:id/mark-completed — mã tham chiếu BẮT BUỘC (vd mã giao dịch hoàn trên trang merchant) để
// sổ cái truy được khoản đã hoàn thủ công; ghi thành gatewayRef = 'MANUAL:<mã>'.
export const adminMarkRefundCompletedSchema = z.object({
  reference: z
    .string({ required_error: 'admin.validationRefundReferenceRequired' })
    .trim()
    .min(1, 'admin.validationRefundReferenceRequired')
    .max(ADMIN_REFUND_REFERENCE_MAX_LENGTH, 'admin.validationRefundReferenceTooLong'),
});
export type AdminMarkRefundCompletedInput = z.infer<typeof adminMarkRefundCompletedSchema>;

// --- Thanh toán bất thường: GET /admin/refundable-payments, POST /admin/payments/:id/refund ----------

// PAID_AFTER_EXPIRY: Payment SUCCESS mà mọi đơn của nhóm đã CANCELLED (tiền đến sau khi giữ chỗ bị thu hồi).
// DUPLICATE: Payment SUCCESS không phải bản SUCCESS sớm nhất của nhóm (khách trả hai lần).
export const abnormalPaymentKindSchema = z.enum(['PAID_AFTER_EXPIRY', 'DUPLICATE']);
export type AbnormalPaymentKind = z.infer<typeof abnormalPaymentKindSchema>;

export const adminRefundablePaymentListQuerySchema = z.object({
  ...paginationShape,
});
export type AdminRefundablePaymentListQuery = z.infer<typeof adminRefundablePaymentListQuerySchema>;

// Chỉ Payment CHƯA có bất kỳ dòng hoàn nào (kể cả FAILED — khi đó xử lý bằng retry / ghi nhận thủ công trên chính
// dòng đó ở /admin/refunds, tránh hoàn hai lần cùng một khoản tiền).
export const adminRefundablePaymentSchema = z.object({
  id: z.string(),
  kind: abnormalPaymentKindSchema,
  method: paymentMethodSchema,
  amount: moneySchema,
  paidAt: z.string().nullable(),
  txnRef: z.string(),
  transactionId: z.string().nullable(),
  checkoutGroupId: z.string(),
  buyer: adminBuyerSchema,
  // Các đơn của nhóm (để Admin thấy vì sao khoản này bất thường).
  orders: z.array(
    z.object({
      id: z.string(),
      status: orderStatusSchema,
      totalAmount: moneySchema,
    }),
  ),
});
export type AdminRefundablePayment = z.infer<typeof adminRefundablePaymentSchema>;

export const adminRefundablePaymentListResponseSchema = z.object({
  items: z.array(adminRefundablePaymentSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminRefundablePaymentListResponse = z.infer<
  typeof adminRefundablePaymentListResponseSchema
>;

// POST /admin/payments/:id/refund — lý do tuỳ chọn (ghi vào PaymentRefund.reason).
export const adminRefundPaymentSchema = z.object({
  reason: optionalText(REFUND_NOTE_MAX_LENGTH, 'admin.validationReasonTooLong'),
});
export type AdminRefundPaymentInput = z.infer<typeof adminRefundPaymentSchema>;
