import type { OrderStatus, PaymentMethod } from '@prisma/client';
import {
  canActorTransitionRefundRequest,
  type RefundRequestKind,
  type RefundRequestStatus,
} from '@ecommerce/types';
import {
  canRetryFromStatus,
  deriveCheckoutGroupStatus,
  type CheckoutGroupStatusPayment,
} from './checkout-group-status';

// Luật "buyer được làm gì với đơn" (Week8.md 1.5, mở rộng ở Week9.md 1.3) — hàm THUẦN để test từng ca, FE
// chỉ đọc các cờ BE trả về (orderListItemSchema.can*) chứ không tự suy lại. Đổi chính sách hủy chỉ sửa đây.

const DAY_MS = 24 * 60 * 60 * 1000;

// Cửa sổ trả hàng tính từ lúc đơn COMPLETED (Week9.md 1.3). Mốc hạn chót vẫn là CÒN trong cửa sổ (bao
// gồm cả đúng thời điểm hết hạn) — một nguồn duy nhất để cờ canRequestReturn và route gửi yêu cầu (2.6)
// không lệch nhau một biên.
export function isWithinRefundWindow(
  completedAt: Date,
  now: Date,
  windowDays: number,
): boolean {
  return now.getTime() <= completedAt.getTime() + windowDays * DAY_MS;
}

export interface BuyerOrderActionsInput {
  status: OrderStatus;
  // Phương thức của lần thử thanh toán mới nhất của nhóm; null nếu nhóm chưa có Payment nào.
  paymentMethod: PaymentMethod | null;
  canRetryPayment: boolean;
  // Lúc đơn COMPLETED (dòng OrderStatusHistory `→ COMPLETED` mới nhất); null nếu đơn chưa/không COMPLETED.
  completedAt: Date | null;
  now: Date;
  refundWindowDays: number;
  // Loại yêu cầu ĐÃ CÓ (chưa rút) của đơn — mỗi đơn tối đa một yêu cầu mỗi loại (index duy nhất từng
  // phần ở refund_requests), nên đã có thì không gửi thêm cùng loại.
  existingRequestKinds: readonly RefundRequestKind[];
}

export interface BuyerOrderActions {
  canCancel: boolean;
  // Gửi yêu cầu hủy (shop đã xác nhận/đóng gói, cần seller duyệt) — Week9.md 1.3.
  canRequestCancel: boolean;
  // Gửi yêu cầu trả hàng/hoàn tiền sau khi đã nhận, trong cửa sổ hoàn trả — Week9.md 1.3.
  canRequestReturn: boolean;
  canConfirmReceived: boolean;
  canRetryPayment: boolean;
}

export function getBuyerOrderActions(
  input: BuyerOrderActionsInput,
): BuyerOrderActions {
  return {
    // `canCancel` = HỦY NGAY, không cần ai duyệt (Week9.md 1.3): đơn chưa thanh toán (hủy theo cả nhóm thanh
    // toán) và đơn đang chờ shop xác nhận — kể cả đơn đã trả online, khi đó hủy kèm hoàn tiền tự động
    // (RefundService). Từ CONFIRMED trở đi người mua chỉ gửi YÊU CẦU hủy (canRequestCancel).
    canCancel:
      input.status === 'AWAITING_PAYMENT' || input.status === 'PENDING',
    canRequestCancel:
      (input.status === 'CONFIRMED' || input.status === 'PACKED') &&
      !input.existingRequestKinds.includes('CANCEL'),
    canRequestReturn:
      input.status === 'COMPLETED' &&
      input.completedAt !== null &&
      isWithinRefundWindow(
        input.completedAt,
        input.now,
        input.refundWindowDays,
      ) &&
      !input.existingRequestKinds.includes('RETURN'),
    canConfirmReceived: input.status === 'SHIPPING',
    canRetryPayment: input.canRetryPayment,
  };
}

// Hạn khiếu nại lên sàn: còn CHO PHÉP đến hết đúng thời điểm statusChangedAt + escalateDays (bao gồm biên),
// cùng quy ước isWithinRefundWindow để cờ canEscalate và route khiếu nại không lệch nhau một biên.
export function isWithinEscalateWindow(
  statusChangedAt: Date,
  now: Date,
  escalateDays: number,
): boolean {
  return now.getTime() <= statusChangedAt.getTime() + escalateDays * DAY_MS;
}

export interface BuyerRefundRequestActionsInput {
  kind: RefundRequestKind;
  status: RefundRequestStatus;
  // Lần đổi trạng thái gần nhất — với REJECTED_BY_SELLER đây là lúc seller từ chối, mốc mở cửa sổ khiếu nại.
  statusChangedAt: Date;
  now: Date;
  escalateDays: number;
}

export interface BuyerRefundRequestActions {
  canWithdraw: boolean;
  canEscalate: boolean;
}

// Luật "người mua làm được gì với YÊU CẦU của mình" (Week9.md 1.4): suy từ bảng chuyển có actor ở
// packages/types (một nguồn duy nhất — rút chỉ khi seller chưa trả lời, khiếu nại chỉ sau khi seller từ chối)
// cộng cửa sổ khiếu nại. FE chỉ đọc các cờ này.
export function getBuyerRefundRequestActions(
  input: BuyerRefundRequestActionsInput,
): BuyerRefundRequestActions {
  return {
    canWithdraw: canActorTransitionRefundRequest(
      'BUYER',
      input.kind,
      input.status,
      'WITHDRAWN',
    ),
    canEscalate:
      canActorTransitionRefundRequest(
        'BUYER',
        input.kind,
        input.status,
        'ESCALATED',
      ) &&
      isWithinEscalateWindow(
        input.statusChangedAt,
        input.now,
        input.escalateDays,
      ),
  };
}

export type CancelBlockReason = 'PROCESSING_STARTED' | 'IN_TRANSIT';

// Vì sao 1 đơn ĐANG SỐNG không hủy/từ chối NGAY được — dùng để trả đúng
// `ORDER_CANCEL_NOT_ALLOWED.details.reason`. null = không có lý do đặc biệt: hoặc hủy ngay được (PENDING, mọi
// phương thức — đơn đã trả online thì hoàn tiền tự động), hoặc đơn ở trạng thái mà nơi gọi báo lỗi khác
// (AWAITING_PAYMENT hủy theo nhóm, đơn đã kết thúc ⇒ ORDER_INVALID_TRANSITION).
//   - PROCESSING_STARTED (CONFIRMED/PACKED): shop đã xử lý, người mua gửi YÊU CẦU hủy chứ không hủy ngay.
//   - IN_TRANSIT (SHIPPING): hàng đã giao cho vận chuyển, không hủy được (Week9.md 1.3).
export function getCancelBlockReason(
  status: OrderStatus,
): CancelBlockReason | null {
  if (status === 'CONFIRMED' || status === 'PACKED') {
    return 'PROCESSING_STARTED';
  }
  if (status === 'SHIPPING') {
    return 'IN_TRANSIT';
  }
  return null;
}

export interface SellerOrderActionsInput {
  status: OrderStatus;
  // Đơn đang có yêu cầu HỦY của người mua chờ xử lý (blocksSellerFulfilment ở packages/types): seller phải
  // phản hồi yêu cầu trước khi đóng gói/giao, nên 2 cờ đó tắt.
  hasBlockingCancelRequest: boolean;
}

export interface SellerOrderActions {
  canConfirm: boolean;
  canPack: boolean;
  canShip: boolean;
  canReject: boolean;
  // Seller tự hủy đơn đã xác nhận/đóng gói (kèm lý do, hoàn tiền nếu đã thu) — Week9.md 1.3.
  canCancel: boolean;
}

// Luật "seller được làm gì với đơn" (Week8.md 1.3/1.5, Week9.md 1.3). Mỗi cờ ứng với đúng 1 cạnh của
// ORDER_STATUS_TRANSITIONS: PENDING → CONFIRMED, CONFIRMED → PACKED, PACKED → SHIPPING, PENDING →
// CANCELLED (từ chối) và CONFIRMED/PACKED → CANCELLED (tự hủy). Seller KHÔNG tự đặt COMPLETED (buyer xác
// nhận đã nhận hoặc job tự hoàn tất).
export function getSellerOrderActions(
  input: SellerOrderActionsInput,
): SellerOrderActions {
  return {
    canConfirm: input.status === 'PENDING',
    canPack: input.status === 'CONFIRMED' && !input.hasBlockingCancelRequest,
    canShip: input.status === 'PACKED' && !input.hasBlockingCancelRequest,
    // Từ chối đơn chờ xác nhận — mọi phương thức: đơn đã trả online thì hoàn tiền tự động (Week9.md 1.3, mở ở
    // 2.7 cùng RefundService + route). Trước đó chỉ đơn COD chưa thu tiền.
    canReject: input.status === 'PENDING',
    // Tự hủy đơn đã xác nhận/đóng gói KHÔNG bị chặn bởi yêu cầu hủy đang chờ: hủy chính là cách trả lời.
    canCancel: input.status === 'CONFIRMED' || input.status === 'PACKED',
  };
}

export interface SellerRefundRequestActionsInput {
  kind: RefundRequestKind;
  status: RefundRequestStatus;
}

export interface SellerRefundRequestActions {
  canApprove: boolean;
  canReject: boolean;
}

// Luật "seller làm được gì với YÊU CẦU của người mua" (Week9.md 1.4) — suy từ bảng chuyển có actor ở
// packages/types (một nguồn duy nhất): duyệt khi đang chờ seller, hoặc khi yêu cầu HỦY đã lên sàn (seller
// nhượng bộ); từ chối chỉ khi đang chờ seller. FE chỉ đọc các cờ này.
export function getSellerRefundRequestActions(
  input: SellerRefundRequestActionsInput,
): SellerRefundRequestActions {
  return {
    canApprove: canActorTransitionRefundRequest(
      'SELLER',
      input.kind,
      input.status,
      'APPROVED',
    ),
    canReject: canActorTransitionRefundRequest(
      'SELLER',
      input.kind,
      input.status,
      'REJECTED_BY_SELLER',
    ),
  };
}

export interface RetryPaymentInput {
  orderStatus: OrderStatus;
  // Mọi lần thử của nhóm (thứ tự bất kỳ — hàm tự sắp theo createdAt).
  payments: CheckoutGroupStatusPayment[];
  groupCreatedAt: Date;
  now: Date;
  maxHoldMinutes: number;
}

// Cùng điều kiện PaymentService.retryPayment sẽ chấp nhận, để nút "Thanh toán lại" chỉ hiện khi bấm
// được thật: đơn chưa thanh toán, lần thử mới nhất là cổng online (không COD) chưa quá hạn giữ chỗ
// (PAYMENT_FAILED hoặc AWAITING_PAYMENT), và nhóm chưa vượt thời gian giữ chỗ tối đa.
export function canRetryOrderPayment(input: RetryPaymentInput): boolean {
  if (input.orderStatus !== 'AWAITING_PAYMENT') return false;

  const latest = [...input.payments].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  if (!latest || latest.method === 'COD') return false;

  const groupStatus = deriveCheckoutGroupStatus(
    [{ status: input.orderStatus }],
    input.payments,
    input.now,
  );
  if (!canRetryFromStatus(groupStatus)) return false;

  const maxHoldAt =
    input.groupCreatedAt.getTime() + input.maxHoldMinutes * 60_000;
  return input.now.getTime() < maxHoldAt;
}
