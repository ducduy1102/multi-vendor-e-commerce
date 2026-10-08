import type { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import type { CheckoutGroupStatus } from '@ecommerce/types';

// Bảng chuyển trạng thái Order hợp lệ (Week7.md 1.13, mở rộng ở Week8.md 1.3). Chỉ nói cạnh nào hợp lệ
// về mặt trạng thái; AI được làm cạnh nào (buyer/seller/hệ thống) và điều kiện kèm theo (vd chỉ đơn COD
// mới hủy được ở PENDING) là luật của service nghiệp vụ. Thực thi thật nằm ở OrderStatusService.transition
// (UPDATE có điều kiện WHERE status = ...). Tuần 9 (Week9.md 1.3/1.4) thêm 3 cạnh: CONFIRMED/PACKED →
// CANCELLED (seller tự hủy hoặc duyệt yêu cầu hủy của người mua) và COMPLETED → REFUNDED (duyệt yêu cầu
// trả hàng sau khi nhận). SHIPPING → CANCELLED vẫn KHÔNG hợp lệ: hàng đã giao cho vận chuyển.
export const ORDER_STATUS_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  AWAITING_PAYMENT: ['PENDING', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['COMPLETED'],
  COMPLETED: ['REFUNDED'],
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
  method: PaymentMethod;
  status: PaymentStatus;
  // null = không hết hạn (Payment COD, Week8.md 1.6).
  expiresAt: Date | null;
  createdAt: Date;
}

// Hàm THUẦN suy ra trạng thái nhóm thanh toán (Week7.md 1.13) — KHÔNG lưu cột riêng để tránh nguồn sự
// thật thứ 2 lệch khỏi Order/Payment. Dùng cho GET /checkout/groups/:groupId và trang kết quả FE.
//
// `hasActiveRefund` = nhóm có ít nhất một khoản hoàn (PaymentRefund) CHƯA FAILED (đang chờ hoặc đã xong).
// Cần vì saga hoàn tiền (Week9.md 1.5) hủy đơn TRƯỚC rồi mới hoàn tiền: giữa hai bước đó mọi đơn đã đóng mà
// Payment còn SUCCESS, trông y hệt "thanh toán đến muộn sau khi nhóm bị thu hồi" — không có cờ này nhóm bị
// báo nhầm PAID_AFTER_EXPIRY ngay khi người mua vừa hủy.
export function deriveCheckoutGroupStatus(
  orders: readonly CheckoutGroupStatusOrder[],
  payments: readonly CheckoutGroupStatusPayment[],
  now: Date,
  hasActiveRefund = false,
): CheckoutGroupStatus {
  const hasSuccess = payments.some((p) => p.status === 'SUCCESS');
  const allCancelled =
    orders.length > 0 && orders.every((o) => o.status === 'CANCELLED');
  // "Đã kết thúc": hủy trước giao (CANCELLED) hoặc hoàn trả sau giao (REFUNDED, Week9.md 1.3). Không
  // coi REFUNDED là đã kết thúc thì nhóm đã hoàn hết tiền (Payment REFUNDED) rơi xuống nhánh "lần thử
  // mới nhất" bên dưới và bị báo nhầm PAYMENT_FAILED/PAYMENT_EXPIRED (giá trị dẫn xuất phải tính lại ở
  // mọi sự kiện làm nó đổi — note-nestjs.md BL).
  const allEnded =
    orders.length > 0 &&
    orders.every((o) => o.status === 'CANCELLED' || o.status === 'REFUNDED');

  if (hasSuccess) {
    // Đơn đã đóng hết và tiền đang được hoàn (hoặc đã hoàn một phần): kết thúc bình thường, chỉ chờ cổng.
    if (allEnded && hasActiveRefund) return 'CANCELLED';
    // Thanh toán muộn sau khi nhóm đã bị thu hồi (1.4) — mọi đơn CANCELLED dù có tiền vào. Chỉ CANCELLED,
    // không tính REFUNDED: đơn REFUNDED là đơn đã giao rồi được hoàn, không phải thanh toán đến trễ.
    return allCancelled ? 'PAID_AFTER_EXPIRY' : 'PAID';
  }
  if (allEnded) return 'CANCELLED';

  // Chưa có Payment SUCCESS và đơn chưa bị huỷ hết ⇒ nhìn LẦN THỬ MỚI NHẤT (theo createdAt).
  const latest = [...payments].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  // Không nên xảy ra thật (placeOrder luôn tạo kèm đúng 1 Payment) — coi như vừa đặt, an toàn.
  if (!latest) return 'AWAITING_PAYMENT';
  // COD: đã đặt thành công, còn đơn hoạt động, CHƯA thu tiền (thu khi nhận hàng) — không có hạn
  // thanh toán nên không bao giờ PAYMENT_EXPIRED/PAYMENT_FAILED, và không có gì để "thử lại".
  if (latest.method === 'COD') return 'COD_PLACED';

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
