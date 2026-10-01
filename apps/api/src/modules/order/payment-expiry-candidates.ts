import type { PrismaClient } from '@prisma/client';

export interface ReclaimCandidateQuery {
  // Giới hạn số nhóm xử lý mỗi lượt (Week7.md 1.4: "take ~50") — job chạy mỗi phút nên không cần
  // quét hết trong 1 lượt, lượt sau dọn tiếp phần còn lại.
  take: number;
  now: Date;
  // Ân hạn tính bằng mili-giây (đã nhân từ readPaymentReclaimGraceMinutes() ở nơi gọi).
  graceMs: number;
}

// Ứng viên THÔ để thu hồi (Week7.md 1.4/2.10) — hàm chỉ ĐỌC, không ghi gì. `reclaimCheckoutGroup`
// (2.9) tự kiểm lại và an toàn dù lỡ gọi với 1 nhóm không thật sự đủ điều kiện (idempotent), nên hàm
// này chỉ cần đủ tốt để không BỎ SÓT ứng viên thật, không cần tuyệt đối chính xác.
//
// Điều kiện: còn ít nhất 1 Order `AWAITING_PAYMENT`, CHƯA có Payment `SUCCESS`, và lần thanh toán
// MỚI NHẤT của nhóm đã quá `expiresAt + ân hạn`. Đúng 2 câu truy vấn (không N+1 theo số nhóm):
// (1) nhóm còn đơn AWAITING_PAYMENT, giới hạn `take`; (2) toàn bộ Payment của các nhóm đó để tìm lần
// mới nhất (sắp `createdAt` giảm dần — dòng gặp ĐẦU TIÊN của mỗi nhóm khi quét từ trên xuống chính là
// lần mới nhất của nhóm đó) và có `SUCCESS` hay không.
export async function findReclaimCandidates(
  prisma: Pick<PrismaClient, 'order' | 'payment'>,
  { take, now, graceMs }: ReclaimCandidateQuery,
): Promise<string[]> {
  const groups = await prisma.order.findMany({
    where: { status: 'AWAITING_PAYMENT' },
    distinct: ['checkoutGroupId'],
    select: { checkoutGroupId: true },
    take,
  });
  const groupIds = groups.map((g) => g.checkoutGroupId);
  if (groupIds.length === 0) return [];

  const payments = await prisma.payment.findMany({
    where: { checkoutGroupId: { in: groupIds } },
    select: {
      checkoutGroupId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const cutoff = new Date(now.getTime() - graceMs);
  const latestExpiresAtByGroup = new Map<string, Date | null>();
  const hasSuccessByGroup = new Set<string>();
  for (const payment of payments) {
    if (payment.status === 'SUCCESS') {
      hasSuccessByGroup.add(payment.checkoutGroupId);
    }
    if (!latestExpiresAtByGroup.has(payment.checkoutGroupId)) {
      latestExpiresAtByGroup.set(payment.checkoutGroupId, payment.expiresAt);
    }
  }

  return groupIds.filter((id) => {
    if (hasSuccessByGroup.has(id)) return false;
    const latestExpiresAt = latestExpiresAtByGroup.get(id);
    // null = Payment COD, không bao giờ hết hạn (Week8.md 1.6).
    return (
      latestExpiresAt !== undefined &&
      latestExpiresAt !== null &&
      latestExpiresAt < cutoff
    );
  });
}
