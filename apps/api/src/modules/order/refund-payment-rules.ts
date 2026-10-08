import type { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

// Luật THUẦN về "hoàn tiền vào khoản thanh toán nào" và "khoản thanh toán nào là bất thường" (Week9.md
// 1.5/1.9) — tách khỏi RefundService để test từng ca không cần DB.

export interface GroupPaymentLike {
  id: string;
  status: PaymentStatus;
  method: PaymentMethod;
  paidAt: Date | null;
}

// Khoản thanh toán online ĐÃ THU của nhóm có `paidAt` sớm nhất (hoà thì theo id) — là khoản mọi hoàn tiền
// theo đơn đi vào. Nhóm có ≥ 2 khoản SUCCESS là ca thanh toán trùng: các khoản sau CHỈ hoàn qua màn Admin.
// null = nhóm chưa thu được đồng online nào (hoặc là nhóm COD).
export function pickRefundablePayment<T extends GroupPaymentLike>(
  payments: readonly T[],
): T | null {
  const collected = payments
    .filter((p) => p.status === 'SUCCESS' && p.method !== 'COD')
    .sort((a, b) => {
      const byPaidAt =
        (a.paidAt?.getTime() ?? Number.POSITIVE_INFINITY) -
        (b.paidAt?.getTime() ?? Number.POSITIVE_INFINITY);
      if (byPaidAt !== 0 && !Number.isNaN(byPaidAt)) return byPaidAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return collected[0] ?? null;
}

export type AbnormalPaymentKind = 'PAID_AFTER_EXPIRY' | 'DUPLICATE';

// Khoản thanh toán này có thuộc loại Admin được hoàn TOÀN BỘ (không gắn đơn) không (Week9.md 1.9):
//   - DUPLICATE: Payment SUCCESS nhưng không phải bản SUCCESS sớm nhất của nhóm (khách trả hai lần);
//   - PAID_AFTER_EXPIRY: Payment SUCCESS mà mọi đơn của nhóm đã CANCELLED (tiền đến sau khi giữ chỗ bị thu hồi).
// null = bình thường (hoặc không phải khoản online đã thu): hoàn tiền phải đi qua đơn, không phải màn này.
// Điều kiện "chưa có khoản hoàn nào" kiểm riêng ở nơi gọi (cần đọc sổ cái).
export function classifyAbnormalPayment(input: {
  paymentId: string;
  groupPayments: readonly GroupPaymentLike[];
  orderStatuses: readonly OrderStatus[];
}): AbnormalPaymentKind | null {
  const payment = input.groupPayments.find((p) => p.id === input.paymentId);
  if (!payment || payment.status !== 'SUCCESS' || payment.method === 'COD') {
    return null;
  }

  const earliest = pickRefundablePayment(input.groupPayments);
  if (earliest && earliest.id !== payment.id) return 'DUPLICATE';

  const allCancelled =
    input.orderStatuses.length > 0 &&
    input.orderStatuses.every((status) => status === 'CANCELLED');
  return allCancelled ? 'PAID_AFTER_EXPIRY' : null;
}

// Mã tham chiếu hoàn gửi cổng, suy ỔN ĐỊNH từ PaymentRefund.id (gọi lại cho cùng khoản hoàn ra đúng cùng mã
// nên cổng không hoàn hai lần). Bỏ gạch ngang → 32 ký tự hex: vừa giới hạn độ dài mã yêu cầu của VNPay
// (vnp_RequestId ≤ 32) và chỉ gồm chữ-số.
export function toRefundRef(refundId: string): string {
  return refundId.replace(/-/g, '');
}
