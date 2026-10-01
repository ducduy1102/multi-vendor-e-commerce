import type { OrderStatus, PaymentStatus } from '@prisma/client';
import type { CheckoutGroupStatus } from '@ecommerce/types';

// Bảng chuyển trạng thái Order hợp lệ (Week7.md 1.13, mở rộng ở Week8.md 1.3). Chỉ nói cạnh nào hợp lệ
// về mặt trạng thái; AI được làm cạnh nào (buyer/seller/hệ thống) và điều kiện kèm theo (vd chỉ đơn COD
// mới hủy được ở PENDING) là luật của service nghiệp vụ. Thực thi thật nằm ở OrderStatusService.transition
// (UPDATE có điều kiện WHERE status = ...). REFUNDED và hủy sau CONFIRMED: Tuần 9.
export const ORDER_STATUS_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  AWAITING_PAYMENT: ['PENDING', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED'],
  PACKED: ['SHIPPING'],
  SHIPPING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function isValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export interface CheckoutGroupStatusOrder {
  status: OrderStatus;
}

export interface CheckoutGroupStatusPayment {
  status: PaymentStatus;
  // null = không hết hạn (Payment COD, Week8.md 1.6).
  expiresAt: Date | null;
  createdAt: Date;
}

// Hàm THUẦN suy ra trạng thái nhóm thanh toán (Week7.md 1.13) — KHÔNG lưu cột riêng để tránh nguồn sự
// thật thứ 2 lệch khỏi Order/Payment. Dùng cho GET /checkout/groups/:groupId và trang kết quả FE.
export function deriveCheckoutGroupStatus(
  orders: readonly CheckoutGroupStatusOrder[],
  payments: readonly CheckoutGroupStatusPayment[],
  now: Date,
): CheckoutGroupStatus {
  const hasSuccess = payments.some((p) => p.status === 'SUCCESS');
  const allCancelled =
    orders.length > 0 && orders.every((o) => o.status === 'CANCELLED');

  if (hasSuccess) {
    // Thanh toán muộn sau khi nhóm đã bị thu hồi (1.4) — mọi đơn CANCELLED dù có tiền vào.
    return allCancelled ? 'PAID_AFTER_EXPIRY' : 'PAID';
  }
  if (allCancelled) return 'CANCELLED';

  // Chưa có Payment SUCCESS và đơn chưa bị huỷ hết ⇒ nhìn LẦN THỬ MỚI NHẤT (theo createdAt).
  const latest = [...payments].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  // Không nên xảy ra thật (placeOrder luôn tạo kèm đúng 1 Payment) — coi như vừa đặt, an toàn.
  if (!latest) return 'AWAITING_PAYMENT';

  const stillWithinHold = latest.expiresAt === null || latest.expiresAt > now;
  if (latest.status === 'PENDING') {
    return stillWithinHold ? 'AWAITING_PAYMENT' : 'PAYMENT_EXPIRED';
  }
  // latest.status === 'FAILED' (SUCCESS đã loại ở nhánh hasSuccess phía trên).
  return stillWithinHold ? 'PAYMENT_FAILED' : 'PAYMENT_EXPIRED';
}

// canRetry (dùng ở checkoutGroupSchema): chỉ khi trạng thái là PAYMENT_FAILED hoặc AWAITING_PAYMENT
// nhưng lần thử mới nhất KHÔNG có payUrl (gọi cổng lỗi sau commit, 1.11 (4b)) — thực tế quyết định ở
// PaymentService.retryPayment/getCheckoutGroup vì cần biết payUrl, hàm này chỉ suy trạng thái hiển thị.
export function canRetryFromStatus(status: CheckoutGroupStatus): boolean {
  return status === 'PAYMENT_FAILED' || status === 'AWAITING_PAYMENT';
}
