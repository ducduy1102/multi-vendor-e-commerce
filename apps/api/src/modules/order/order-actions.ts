import type { OrderStatus, PaymentMethod } from '@prisma/client';
import {
  canRetryFromStatus,
  deriveCheckoutGroupStatus,
  type CheckoutGroupStatusPayment,
} from './checkout-group-status';

// Luật "buyer được làm gì với đơn" (Week8.md 1.5) — hàm THUẦN để test từng ca, FE chỉ đọc các cờ BE
// trả về (orderListItemSchema.can*) chứ không tự suy lại. Đổi chính sách hủy ở Tuần 9 chỉ sửa đây.

export interface BuyerOrderActionsInput {
  status: OrderStatus;
  // Phương thức của lần thử thanh toán mới nhất của nhóm; null nếu nhóm chưa có Payment nào.
  paymentMethod: PaymentMethod | null;
  canRetryPayment: boolean;
}

export interface BuyerOrderActions {
  canCancel: boolean;
  canConfirmReceived: boolean;
  canRetryPayment: boolean;
}

export function getBuyerOrderActions(
  input: BuyerOrderActionsInput,
): BuyerOrderActions {
  return {
    // Chỉ hủy được khi CHƯA đụng tới tiền thật: đơn chưa thanh toán (hủy theo cả nhóm thanh toán) và
    // đơn COD chờ shop xác nhận. Đơn đã trả online (PENDING + VNPAY/MOMO) và mọi đơn đã xác nhận trở đi
    // hủy kèm hoàn tiền — Tuần 9.
    canCancel:
      input.status === 'AWAITING_PAYMENT' ||
      (input.status === 'PENDING' && input.paymentMethod === 'COD'),
    canConfirmReceived: input.status === 'SHIPPING',
    canRetryPayment: input.canRetryPayment,
  };
}

export interface SellerOrderActionsInput {
  status: OrderStatus;
  // Phương thức của lần thử thanh toán mới nhất của nhóm; null nếu nhóm chưa có Payment nào.
  paymentMethod: PaymentMethod | null;
}

export interface SellerOrderActions {
  canConfirm: boolean;
  canPack: boolean;
  canShip: boolean;
  canReject: boolean;
}

// Luật "seller được làm gì với đơn" (Week8.md 1.3/1.5). Mỗi cờ ứng với đúng 1 cạnh của
// ORDER_STATUS_TRANSITIONS: PENDING → CONFIRMED, CONFIRMED → PACKED, PACKED → SHIPPING, và PENDING →
// CANCELLED (từ chối). Seller KHÔNG tự đặt COMPLETED (buyer xác nhận đã nhận hoặc job tự hoàn tất).
export function getSellerOrderActions(
  input: SellerOrderActionsInput,
): SellerOrderActions {
  return {
    canConfirm: input.status === 'PENDING',
    canPack: input.status === 'CONFIRMED',
    canShip: input.status === 'PACKED',
    // Chỉ từ chối được đơn COD chưa thu tiền; đơn đã trả online từ chối kèm hoàn tiền — Tuần 9.
    canReject: input.status === 'PENDING' && input.paymentMethod === 'COD',
  };
}

export interface RetryPaymentInput {
  orderStatus: OrderStatus;
  // Mọi lần thử của nhóm (thứ tự bất kỳ — hàm tự sắp theo createdAt).
  payments: (CheckoutGroupStatusPayment & { method: PaymentMethod })[];
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
