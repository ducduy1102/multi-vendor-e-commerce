import type { PrismaClient } from '@prisma/client';

export interface AutoCompleteCandidateQuery {
  // Giới hạn số đơn xử lý mỗi lượt — job chạy mỗi giờ nên phần còn lại được dọn ở lượt sau.
  take: number;
  now: Date;
  // Số ngày kể từ lúc đơn được giao (chuyển sang SHIPPING) mà buyer chưa xác nhận.
  days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Ứng viên THÔ để tự hoàn tất (Week8.md 1.7/2.9) — hàm chỉ ĐỌC. Việc hoàn tất thật tự kiểm lại trong
// transaction (UPDATE có điều kiện `status = SHIPPING`) nên lỡ trả nhầm 1 đơn buyer vừa xác nhận cũng
// an toàn. Mốc "đã giao" lấy từ OrderStatusHistory (dòng chuyển sang SHIPPING) chứ không từ
// `Order.updatedAt` — `updatedAt` đổi cả khi seller sửa mã vận đơn sau đó, làm trễ hạn tự hoàn tất.
// Sắp cũ nhất trước để đơn quá hạn lâu nhất được xử lý trước nếu có nhiều hơn `take`.
export async function findAutoCompleteCandidates(
  prisma: Pick<PrismaClient, 'order'>,
  { take, now, days }: AutoCompleteCandidateQuery,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const orders = await prisma.order.findMany({
    where: {
      status: 'SHIPPING',
      statusHistory: {
        some: { toStatus: 'SHIPPING', createdAt: { lt: cutoff } },
      },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take,
  });
  return orders.map((order) => order.id);
}
