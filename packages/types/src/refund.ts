import { z } from 'zod';
import { optionalText } from './optional-text';
import { orderActorTypeSchema, type OrderActorType } from './order-status';

// Số tiền VND luôn là chuỗi số nguyên đồng trong RESPONSE (cùng quy ước order.ts/checkout.ts).
const moneySchema = z.string();

// --- Loại yêu cầu và trạng thái (Week9.md 1.3/1.4) -------------------------------------------------
// Khớp enum RefundRequestKind / RefundRequestStatus / PaymentRefundStatus của Prisma.
//   CANCEL: người mua xin hủy khi shop đã xác nhận/đóng gói (CONFIRMED, PACKED);
//   RETURN: người mua xin trả hàng/hoàn tiền sau khi đã nhận (COMPLETED, trong cửa sổ hoàn trả).
// Kind do BE SUY RA từ trạng thái đơn, không nhận từ client.
export const refundRequestKindSchema = z.enum(['CANCEL', 'RETURN']);
export type RefundRequestKind = z.infer<typeof refundRequestKindSchema>;

export const refundRequestStatusSchema = z.enum([
  'PENDING_SELLER',
  'APPROVED',
  'REJECTED_BY_SELLER',
  'ESCALATED',
  'REJECTED',
  'WITHDRAWN',
]);
export type RefundRequestStatus = z.infer<typeof refundRequestStatusSchema>;

// Trạng thái của MỘT khoản tiền hoàn ra khỏi hệ thống (sổ cái PaymentRefund).
export const paymentRefundStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type PaymentRefundStatus = z.infer<typeof paymentRefundStatusSchema>;

// --- State machine của yêu cầu, MỖI cạnh kèm ACTOR (cùng mẫu SHOP_STATUS_TRANSITIONS) ---------------
//   PENDING_SELLER     → APPROVED            SELLER | ADMIN | SYSTEM (SYSTEM chỉ kind CANCEL, khi quá hạn)
//   PENDING_SELLER     → REJECTED_BY_SELLER  SELLER (bắt buộc lý do)
//   PENDING_SELLER     → ESCALATED           SYSTEM (chỉ kind RETURN, khi quá hạn — không tự duyệt trả hàng)
//   PENDING_SELLER     → REJECTED            ADMIN
//   PENDING_SELLER     → WITHDRAWN           BUYER
//   REJECTED_BY_SELLER → ESCALATED           BUYER (trong cửa sổ khiếu nại; kiểm ở service)
//   ESCALATED          → APPROVED            ADMIN
//   ESCALATED          → REJECTED            ADMIN (bắt buộc lý do)
// Chỉ nói cạnh nào hợp lệ + ai làm được; thực thi thật nằm ở RefundRequestService.transition (UPDATE có
// điều kiện WHERE status = <cũ> + ghi RefundRequestHistory cùng transaction). Cố ý KHÔNG có hàm "cạnh
// này tồn tại với bất kỳ ai không": kiểm cạnh mà không kèm actor là cách để vô tình cho phép cạnh của
// actor khác.
export interface RefundRequestTransition {
  from: RefundRequestStatus;
  to: RefundRequestStatus;
  actor: OrderActorType;
}

export const REFUND_REQUEST_TRANSITIONS: readonly RefundRequestTransition[] = [
  { from: 'PENDING_SELLER', to: 'APPROVED', actor: 'SELLER' },
  { from: 'PENDING_SELLER', to: 'APPROVED', actor: 'ADMIN' },
  { from: 'PENDING_SELLER', to: 'APPROVED', actor: 'SYSTEM' },
  { from: 'PENDING_SELLER', to: 'REJECTED_BY_SELLER', actor: 'SELLER' },
  { from: 'PENDING_SELLER', to: 'ESCALATED', actor: 'SYSTEM' },
  { from: 'PENDING_SELLER', to: 'REJECTED', actor: 'ADMIN' },
  { from: 'PENDING_SELLER', to: 'WITHDRAWN', actor: 'BUYER' },
  { from: 'REJECTED_BY_SELLER', to: 'ESCALATED', actor: 'BUYER' },
  { from: 'ESCALATED', to: 'APPROVED', actor: 'ADMIN' },
  { from: 'ESCALATED', to: 'REJECTED', actor: 'ADMIN' },
];

export function canActorTransitionRefundRequest(
  actor: OrderActorType,
  kind: RefundRequestKind,
  from: RefundRequestStatus,
  to: RefundRequestStatus,
): boolean {
  const hasEdge = REFUND_REQUEST_TRANSITIONS.some(
    (edge) => edge.actor === actor && edge.from === from && edge.to === to,
  );
  if (!hasEdge) return false;
  // Hệ thống chỉ hành động theo HẠN và chỉ theo đúng một hướng cho mỗi loại: hủy trước giao ⇒ tự duyệt
  // (hàng chưa rời shop), trả hàng sau giao ⇒ chuyển Admin (hàng có thể chưa trả về, không tự duyệt tiền).
  if (actor === 'SYSTEM') {
    return (
      (to === 'APPROVED' && kind === 'CANCEL') || (to === 'ESCALATED' && kind === 'RETURN')
    );
  }
  return true;
}

// Các trạng thái đích `actor` được đưa 1 yêu cầu (loại `kind`) đang ở `from` tới — FE dùng để suy nút,
// BE dùng để so khớp tập đích của body.
export function refundRequestTargets(
  actor: OrderActorType,
  kind: RefundRequestKind,
  from: RefundRequestStatus,
): RefundRequestStatus[] {
  return [
    ...new Set(
      REFUND_REQUEST_TRANSITIONS.filter(
        (edge) =>
          edge.actor === actor &&
          edge.from === from &&
          canActorTransitionRefundRequest(actor, kind, from, edge.to),
      ).map((edge) => edge.to),
    ),
  ];
}

// Trạng thái cuối: không còn cạnh nào đi ra. (REJECTED_BY_SELLER không nằm đây: người mua còn khiếu nại
// được trong cửa sổ — hết cửa sổ thì coi như cuối, tính từ `statusChangedAt` lúc gọi, không cần job.)
export const REFUND_REQUEST_TERMINAL_STATUSES: readonly RefundRequestStatus[] = [
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

export function isRefundRequestTerminal(status: RefundRequestStatus): boolean {
  return REFUND_REQUEST_TERMINAL_STATUSES.includes(status);
}

// Yêu cầu HỦY còn chờ xử lý (seller hoặc Admin) thì seller KHÔNG được đóng gói/giao đơn đó: hàng đang bị
// người mua xin hủy, phải trả lời trước (Week9.md 1.3). BE dùng để trả 409 REFUND_REQUEST_PENDING và tắt cờ
// canPack/canShip; FE chỉ đọc cờ.
export function blocksSellerFulfilment(kind: RefundRequestKind, status: RefundRequestStatus): boolean {
  return kind === 'CANCEL' && (status === 'PENDING_SELLER' || status === 'ESCALATED');
}

// --- Lý do (Week9.md 1.3) --------------------------------------------------------------------------
// Mã lý do là chuỗi kiểm bằng Zod chứ KHÔNG phải enum DB, để thêm mã không cần migration; nhãn dịch ở FE
// (namespace `order`). Mỗi loại yêu cầu chỉ nhận một tập con — FE dựng <select> từ
// REFUND_REASON_CODES_BY_KIND, BE kiểm lại bằng isRefundReasonAllowedForKind (kind do BE suy ra).
export const REFUND_REASON_CODES = [
  'CHANGE_OF_MIND',
  'ORDER_INFO_WRONG',
  'FOUND_CHEAPER',
  'DELIVERY_TOO_SLOW',
  'DAMAGED',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'MISSING_ITEM',
  'OTHER',
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const REFUND_REASON_CODES_BY_KIND = {
  CANCEL: ['CHANGE_OF_MIND', 'ORDER_INFO_WRONG', 'FOUND_CHEAPER', 'DELIVERY_TOO_SLOW', 'OTHER'],
  RETURN: ['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'MISSING_ITEM', 'OTHER'],
} as const satisfies Record<RefundRequestKind, readonly RefundReasonCode[]>;

export function isRefundReasonAllowedForKind(
  kind: RefundRequestKind,
  code: RefundReasonCode,
): boolean {
  return (REFUND_REASON_CODES_BY_KIND[kind] as readonly RefundReasonCode[]).includes(code);
}

export const REFUND_NOTE_MAX_LENGTH = 500;

// Thiếu và sai giá trị cùng 1 errorMap vì zod không cho trộn `errorMap` với required_error/invalid_type_error.
export const refundReasonCodeSchema = z.enum(REFUND_REASON_CODES, {
  errorMap: (issue, ctx) => ({
    message:
      issue.code === 'invalid_type' && ctx.data === undefined
        ? 'order.validationRefundReasonRequired'
        : 'order.validationRefundReasonInvalid',
  }),
});

// --- Body các hành động ----------------------------------------------------------------------------

// POST /orders/:id/refund-requests — lý do bắt buộc chọn từ danh sách; chọn OTHER thì phải nhập ghi chú.
// `superRefine` đặt SAU object nên input/output type của form vẫn là { reasonCode, reasonNote? }.
export const createRefundRequestSchema = z
  .object({
    reasonCode: refundReasonCodeSchema,
    reasonNote: optionalText(REFUND_NOTE_MAX_LENGTH, 'order.validationRefundNoteTooLong'),
  })
  .superRefine((value, ctx) => {
    if (value.reasonCode === 'OTHER' && !value.reasonNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonNote'],
        message: 'order.validationRefundNoteRequired',
      });
    }
  });
export type CreateRefundRequestInput = z.infer<typeof createRefundRequestSchema>;

// Lý do của người ra quyết định (seller/Admin) — ghi vào RefundRequestHistory.note, bên kia đọc được.
const requiredDecisionNote = z
  .string({ required_error: 'order.validationReasonRequired' })
  .trim()
  .min(1, 'order.validationReasonRequired')
  .max(REFUND_NOTE_MAX_LENGTH, 'order.validationReasonTooLong');

// POST /shops/:shopId/refund-requests/:id/approve — ghi chú tuỳ chọn.
export const approveRefundRequestSchema = z.object({
  note: optionalText(REFUND_NOTE_MAX_LENGTH, 'order.validationReasonTooLong'),
});
export type ApproveRefundRequestInput = z.infer<typeof approveRefundRequestSchema>;

// POST /shops/:shopId/refund-requests/:id/reject — ghi chú BẮT BUỘC (người mua cần biết vì sao).
export const rejectRefundRequestSchema = z.object({ note: requiredDecisionNote });
export type RejectRefundRequestInput = z.infer<typeof rejectRefundRequestSchema>;

// POST /admin/refund-requests/:id/decide — duyệt (ghi chú tuỳ chọn) hoặc từ chối (ghi chú bắt buộc).
export const adminDecideRefundRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: optionalText(REFUND_NOTE_MAX_LENGTH, 'order.validationReasonTooLong'),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECT' && !value.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'order.validationReasonRequired',
      });
    }
  });
export type AdminDecideRefundRequestInput = z.infer<typeof adminDecideRefundRequestSchema>;

// --- Response --------------------------------------------------------------------------------------

// 1 dòng của dòng thời gian yêu cầu. KHÔNG có actorId (không lộ danh tính seller/Admin cho phía bên kia)
// và không có fromStatus (timeline đọc theo toStatus, mốc tạo yêu cầu là dòng PENDING_SELLER đầu tiên).
// `note` là lý do của người ra quyết định; null khi không có lý do.
export const refundRequestHistoryItemSchema = z.object({
  toStatus: refundRequestStatusSchema,
  actorType: orderActorTypeSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type RefundRequestHistoryItem = z.infer<typeof refundRequestHistoryItemSchema>;

// Yêu cầu nhìn từ phía người mua (chi tiết đơn). `reasonCode` để chuỗi thường (không enum): mã lạ do BE
// thêm sau thì FE rơi về nhãn chung thay vì parse hỏng cả đơn. Các cờ do BE tính — FE không tự suy luật
// (cửa sổ khiếu nại tính từ statusChangedAt ở BE).
export const buyerRefundRequestSchema = z.object({
  id: z.string(),
  kind: refundRequestKindSchema,
  status: refundRequestStatusSchema,
  reasonCode: z.string(),
  reasonNote: z.string().nullable(),
  // Hạn seller phản hồi (ISO); quá hạn hệ thống tự duyệt (CANCEL) hoặc chuyển Admin (RETURN).
  sellerRespondBy: z.string(),
  statusChangedAt: z.string(),
  createdAt: z.string(),
  history: z.array(refundRequestHistoryItemSchema),
  canWithdraw: z.boolean(),
  canEscalate: z.boolean(),
});
export type BuyerRefundRequest = z.infer<typeof buyerRefundRequestSchema>;

// Tóm tắt khoản hoàn tiền của MỘT đơn (từ sổ cái PaymentRefund) — người mua thấy trạng thái và số tiền,
// không thấy lý do lỗi nội bộ/mã cổng. Đơn COD không có (hoàn tiền mặt ngoài hệ thống).
export const orderRefundSummarySchema = z.object({
  status: paymentRefundStatusSchema,
  amount: moneySchema,
});
export type OrderRefundSummary = z.infer<typeof orderRefundSummarySchema>;
