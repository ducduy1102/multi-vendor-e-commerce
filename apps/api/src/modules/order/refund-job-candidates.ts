import type { PrismaClient } from '@prisma/client';

export interface OverdueRequestQuery {
  // Giới hạn số yêu cầu xử lý mỗi lượt — job chạy mỗi 15 phút nên phần còn lại được dọn ở lượt sau.
  take: number;
  now: Date;
}

// Ứng viên THÔ cho lượt 1 của RefundJob (Week9.md 1.5/2.8): yêu cầu hủy/trả hàng còn chờ seller mà hạn phản
// hồi `sellerRespondBy` đã qua. Hàm chỉ ĐỌC; việc xử lý thật tự kiểm lại trạng thái (UPDATE có điều kiện
// `status = PENDING_SELLER`) nên lỡ trả nhầm 1 yêu cầu seller vừa duyệt cũng an toàn. Quá hạn lâu nhất xử lý
// trước nếu có nhiều hơn `take`. Khớp index [status, sellerRespondBy].
export async function findOverdueRefundRequests(
  prisma: Pick<PrismaClient, 'refundRequest'>,
  { take, now }: OverdueRequestQuery,
): Promise<string[]> {
  const requests = await prisma.refundRequest.findMany({
    where: { status: 'PENDING_SELLER', sellerRespondBy: { lt: now } },
    orderBy: { sellerRespondBy: 'asc' },
    select: { id: true },
    take,
  });
  return requests.map((request) => request.id);
}

export interface StaleRefundQuery {
  take: number;
  now: Date;
  // PENDING không được chạm tới trong ngần này (tính từ updatedAt) mới bị coi là "bị bỏ dở" — đủ dài để một
  // lần gọi cổng đang chạy không bị nhận nhầm (REFUND_PENDING_STALE_MS).
  staleMs: number;
  maxAttempts: number;
}

// Lượt 2 — khoản hoàn PENDING bị bỏ dở (crash giữa Tx1 và Tx2, cổng treo/quá hạn) mà CÒN lượt thử tự động:
// chạy lại đường executeRefund (cùng mã tham chiếu ổn định nên cổng không hoàn hai lần). Cũ nhất trước.
// Khớp index [status, updatedAt].
export async function findRetryableStaleRefunds(
  prisma: Pick<PrismaClient, 'paymentRefund'>,
  { take, now, staleMs, maxAttempts }: StaleRefundQuery,
): Promise<string[]> {
  const refunds = await prisma.paymentRefund.findMany({
    where: {
      status: 'PENDING',
      attempts: { lt: maxAttempts },
      updatedAt: { lt: new Date(now.getTime() - staleMs) },
    },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
    take,
  });
  return refunds.map((refund) => refund.id);
}

// Lượt 2 — khoản hoàn PENDING bị bỏ dở đã HẾT lượt thử tự động: job đánh dấu FAILED để Admin thử lại hoặc ghi
// nhận đã hoàn thủ công. Cùng điều kiện bỏ dở với hàm trên, chỉ khác `attempts >= maxAttempts`.
export async function findExhaustedStaleRefunds(
  prisma: Pick<PrismaClient, 'paymentRefund'>,
  { take, now, staleMs, maxAttempts }: StaleRefundQuery,
): Promise<string[]> {
  const refunds = await prisma.paymentRefund.findMany({
    where: {
      status: 'PENDING',
      attempts: { gte: maxAttempts },
      updatedAt: { lt: new Date(now.getTime() - staleMs) },
    },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
    take,
  });
  return refunds.map((refund) => refund.id);
}
