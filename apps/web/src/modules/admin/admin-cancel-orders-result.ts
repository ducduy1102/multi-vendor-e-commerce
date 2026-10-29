import type {
  AdminCancelShopOrdersFailure,
  AdminCancelShopOrdersManualRefund,
  AdminCancelShopOrdersResult,
} from './types';

// Kết quả TÍCH LUỸ của một phiên hủy hàng loạt trong hộp thoại: mỗi lần gọi API xử lý tối đa một lô nên Admin có thể bấm "Hủy
// tiếp" nhiều lần, và màn kết quả phải cho thấy cả phiên chứ không chỉ lần gọi cuối.
export interface CancelShopOrdersSummary {
  // Tổng số đơn đã hủy qua mọi lần gọi.
  cancelled: number;
  // Đơn không hủy được trong lần gọi GẦN NHẤT. Không cộng dồn: đơn lỗi vẫn còn "chưa giao" nên lần gọi sau thử lại, hễ hủy được
  // thì biến khỏi danh sách; cộng dồn sẽ hiện mãi một đơn đã được xử lý xong.
  failed: AdminCancelShopOrdersFailure[];
  // Đơn đã hủy mà cổng từ chối hoàn tiền, cộng dồn qua các lần gọi (đơn đã hủy thì không bao giờ xuất hiện lại ở lần sau);
  // khử trùng theo khoản hoàn để một khoản không bị đếm hai lần.
  needsManualRefund: AdminCancelShopOrdersManualRefund[];
  refundsPending: number;
  // Số đơn chưa giao còn lại SAU lần gọi gần nhất.
  remaining: number;
}

export function mergeCancelResults(
  previous: CancelShopOrdersSummary | null,
  next: AdminCancelShopOrdersResult,
): CancelShopOrdersSummary {
  const knownRefunds = new Set(previous?.needsManualRefund.map((item) => item.refundId));
  return {
    cancelled: (previous?.cancelled ?? 0) + next.cancelled,
    failed: next.failed,
    needsManualRefund: [
      ...(previous?.needsManualRefund ?? []),
      ...next.needsManualRefund.filter((item) => !knownRefunds.has(item.refundId)),
    ],
    refundsPending: (previous?.refundsPending ?? 0) + next.refundsPending,
    remaining: next.remaining,
  };
}

// Mã đơn hiển thị cho người xem: 8 ký tự đầu của id, KHÔNG viết hoa — khớp cách các màn đơn hàng khác (SellerOrderCard,
// thông báo) gọi cùng một đơn để Admin đối chiếu được giữa các màn.
export function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8);
}
