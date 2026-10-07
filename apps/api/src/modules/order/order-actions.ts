import type { OrderStatus, PaymentMethod } from '@prisma/client';
import type { RefundRequestKind } from '@ecommerce/types';
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
    // `canCancel` = HỦY NGAY, không cần ai duyệt. Hiện (Week9.md 2.3) vẫn giữ luật Tuần 8: đơn chưa thanh
    // toán (hủy theo cả nhóm thanh toán) và đơn COD chờ shop xác nhận. Đơn đã trả ONLINE chờ xác nhận sẽ
    // hủy ngay được kèm hoàn tiền ở 2.6 — cờ chỉ bật cùng lúc có RefundService và route hủy, để không có
    // nút bấm ra 409.
    canCancel:
      input.status === 'AWAITING_PAYMENT' ||
      (input.status === 'PENDING' && input.paymentMethod === 'COD'),
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

export type CancelBlockReason =
  'PAID_ONLINE' | 'PROCESSING_STARTED' | 'IN_TRANSIT';

// Vì sao 1 đơn ĐANG SỐNG không hủy/từ chối NGAY được — dùng để trả đúng
// `ORDER_CANCEL_NOT_ALLOWED.details.reason`. null = không có lý do đặc biệt: hoặc hủy được (PENDING +
// COD), hoặc đơn ở trạng thái mà nơi gọi báo lỗi khác (AWAITING_PAYMENT hủy theo nhóm, đơn đã kết thúc
// ⇒ ORDER_INVALID_TRANSITION).
//   - PROCESSING_STARTED (CONFIRMED/PACKED): shop đã xử lý, người mua gửi YÊU CẦU hủy chứ không hủy ngay.
//   - IN_TRANSIT (SHIPPING): hàng đã giao cho vận chuyển, không hủy được (Week9.md 1.3).
//   - PAID_ONLINE (PENDING đã trả online): còn tới 2.6/2.7, khi đơn đó hủy ngay được kèm hoàn tiền thì
//     lý do này biến mất khỏi hàm và khỏi `error-code.ts`.
export function getCancelBlockReason(
  status: OrderStatus,
  paymentMethod: PaymentMethod | null,
): CancelBlockReason | null {
  if (status === 'PENDING') {
    return paymentMethod === 'COD' ? null : 'PAID_ONLINE';
  }
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
  // Phương thức của lần thử thanh toán mới nhất của nhóm; null nếu nhóm chưa có Payment nào.
  paymentMethod: PaymentMethod | null;
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
    // Hiện vẫn chỉ từ chối được đơn COD chưa thu tiền (luật Tuần 8); đơn đã trả online từ chối kèm hoàn
    // tiền sẽ mở ở 2.7 cùng route — cùng lý do với canCancel của buyer ở trên.
    canReject: input.status === 'PENDING' && input.paymentMethod === 'COD',
    // Tự hủy đơn đã xác nhận/đóng gói KHÔNG bị chặn bởi yêu cầu hủy đang chờ: hủy chính là cách trả lời.
    canCancel: input.status === 'CONFIRMED' || input.status === 'PACKED',
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
