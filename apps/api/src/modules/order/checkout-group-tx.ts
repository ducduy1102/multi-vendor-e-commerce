import type { OrderStatus } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';

// Việc chạy TRONG transaction của người gọi và tác động lên CẢ NHÓM thanh toán (nhiều đơn / nhiều shop,
// 1 Payment COD chung): dùng chung cho OrderActionService (hoàn tất / hủy đơn COD) và RefundService (hủy
// kèm hoàn tiền, trả hàng) — viết một lần để hai nơi không lệch nhau (note-nestjs.md BL: giá trị dẫn xuất
// phải tính lại ở MỌI sự kiện làm nó đổi).

// Khoá TOÀN BỘ đơn của nhóm theo id tăng dần và trả về trạng thái hiện tại của chúng. Phải gọi TRƯỚC khi
// chuyển trạng thái / đọc tổng hợp cả nhóm: khoá từng dòng không đủ khi quyết định phụ thuộc nhiều dòng
// "anh em" (write skew, note-nestjs.md AV). Thứ tự id tăng dần là thứ tự khoá chung của mọi luồng chạm
// vào tập đơn của một nhóm (AJ).
export async function lockGroupOrders(
  tx: TxClient,
  checkoutGroupId: string,
): Promise<{ id: string; status: OrderStatus }[]> {
  return tx.$queryRaw<{ id: string; status: OrderStatus }[]>`
    SELECT id, status FROM orders WHERE checkout_group_id = ${checkoutGroupId} ORDER BY id FOR UPDATE`;
}

export type CodPaymentSettlement = 'SUCCESS' | 'CANCELLED';

// Hàm THUẦN quyết định số phận của Payment COD (1 Payment cho cả nhóm, không đối soát từng shop —
// Week8.md 1.6) từ trạng thái các đơn trong nhóm:
//   - còn đơn chưa tới đích (chưa COMPLETED/CANCELLED/REFUNDED) ⇒ null (giữ PENDING);
//   - mọi đơn đã tới đích và có ≥ 1 đơn từng được GIAO (COMPLETED, hoặc REFUNDED — đã giao rồi được hoàn,
//     tiền mặt đã thu lúc nhận hàng) ⇒ 'SUCCESS';
//   - mọi đơn đều CANCELLED ⇒ 'CANCELLED' = "không thu" (Week9.md 1.2), thay cho PENDING kẹt mãi.
export function decideCodPaymentStatus(
  orderStatuses: readonly OrderStatus[],
): CodPaymentSettlement | null {
  if (orderStatuses.length === 0) return null;
  const allEnded = orderStatuses.every(
    (status) =>
      status === 'COMPLETED' || status === 'CANCELLED' || status === 'REFUNDED',
  );
  if (!allEnded) return null;
  const wasCollected = orderStatuses.some(
    (status) => status === 'COMPLETED' || status === 'REFUNDED',
  );
  return wasCollected ? 'SUCCESS' : 'CANCELLED';
}

// Tính lại và ghi trạng thái Payment COD của nhóm. Gọi ở MỌI đường đưa một đơn COD tới đích (hoàn tất, hủy,
// từ chối, trả hàng). Cập nhật có điều kiện `status = 'PENDING'` nên gọi lặp an toàn và không bao giờ ghi
// đè một Payment đã SUCCESS/CANCELLED. Người gọi đã khoá nhóm (lockGroupOrders) hoặc ít nhất đã lật đơn của
// mình trong cùng transaction.
export async function settleCodPayment(
  tx: TxClient,
  checkoutGroupId: string,
): Promise<void> {
  const orders = await tx.order.findMany({
    where: { checkoutGroupId },
    select: { status: true },
  });
  const decision = decideCodPaymentStatus(orders.map((order) => order.status));
  if (!decision) return;

  await tx.payment.updateMany({
    where: { checkoutGroupId, method: 'COD', status: 'PENDING' },
    data:
      decision === 'SUCCESS'
        ? { status: 'SUCCESS', paidAt: new Date() }
        : { status: 'CANCELLED' },
  });
}

export interface VoucherReleaseOrder {
  status: OrderStatus;
  // Số giảm giá đã chia cho đơn này (Order.discountAmount, VND).
  discountAmount: number;
}

// Hàm THUẦN: nhóm có được trả lại lượt voucher không (Week9.md 1.7). VoucherUsage gắn với CẢ NHÓM (1 lượt
// cho cả lần checkout), nên chỉ trả khi MỌI đơn đang hưởng giảm giá (discountAmount > 0) đều đã CANCELLED
// trước giao. Nhóm hủy một phần mà còn đơn khác vẫn hưởng giảm ⇒ giữ lượt; đơn REFUNDED (đã giao rồi hoàn)
// KHÔNG trả lượt — voucher đã được dùng thật.
export function shouldReleaseVoucher(
  orders: readonly VoucherReleaseOrder[],
): boolean {
  const discounted = orders.filter((order) => order.discountAmount > 0);
  return (
    discounted.length > 0 &&
    discounted.every((order) => order.status === 'CANCELLED')
  );
}
