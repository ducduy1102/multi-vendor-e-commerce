import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NOTIFICATIONS_MAX_PAGE_SIZE,
  type ListNotificationsQuery,
  type MarkAllNotificationsReadResult,
  type MarkNotificationReadResult,
  type NotificationList,
  type NotificationUnreadCount,
} from '@ecommerce/types';
import type { Prisma } from '@prisma/client';
import { toNotificationDto } from '../../shared/notification/notification.mapper';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
} from './notification-cursor';

const rowSelect = {
  id: true,
  type: true,
  data: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

// Hộp thông báo của MỘT người dùng (Week10.md 7.6) — phía ĐỌC của thông báo (phía ghi là shared/notification). Mọi hàm nhận
// `userId` từ phiên đã xác thực (JwtAuthGuard) và LUÔN đưa nó vào điều kiện truy vấn: không có đường nào đọc hay đổi thông
// báo của người khác, và thông báo của người khác, không tồn tại hay id sai dạng cùng trả 404 như nhau (không lộ id nào có
// thật). Hàng nào có loại lạ hoặc dữ liệu sai hình dạng được `toNotificationDto` đổi thành thông báo chung — dữ liệu không
// được kiểm không bao giờ ra khỏi API.
@Injectable()
export class NotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}

  // Mới nhất trước, phân trang bằng con trỏ (createdAt, id). `unreadOnly` chỉ lọc `read_at IS NULL` — cùng chỉ mục với đếm.
  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationList> {
    // Controller đã kiểm bằng Zod; service vẫn kiểm lại phần đi vào truy vấn (không tin nơi gọi).
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > NOTIFICATIONS_MAX_PAGE_SIZE
    ) {
      throw new BadRequestException('Invalid limit');
    }
    const cursor =
      query.cursor === undefined
        ? null
        : decodeNotificationCursor(query.cursor);
    if (query.cursor !== undefined && !cursor) {
      throw new BadRequestException('Invalid cursor');
    }

    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Lấy thừa 1 dòng để biết còn trang sau mà không phải đếm.
      take: query.limit + 1,
      select: rowSelect,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toNotificationDto(row)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeNotificationCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  // Số chưa đọc CHÍNH XÁC (không trần) cho huy hiệu.
  async unreadCount(userId: string): Promise<NotificationUnreadCount> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount };
  }

  // Đánh dấu MỘT thông báo của mình là đã đọc. IDEMPOTENT và an toàn khi gọi đồng thời: UPDATE có điều kiện
  // `read_at IS NULL` chỉ ĐẶT mốc một lần (gọi lại không ghi đè mốc cũ), rồi đọc lại mốc thật để trả về — nên hai request
  // cùng lúc đều thành công và nhận cùng một mốc. Thông báo của người khác / không tồn tại / id sai dạng ⇒ 404 như nhau.
  async markRead(
    userId: string,
    id: string,
  ): Promise<MarkNotificationReadResult> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { readAt: true },
    });
    if (!row?.readAt) throw new NotFoundException('Notification not found');
    return { readAt: row.readAt.toISOString() };
  }

  // Đánh dấu TẤT CẢ thông báo chưa đọc của mình. Idempotent: gọi lại khi không còn gì chưa đọc trả `updatedCount: 0`.
  async markAllRead(userId: string): Promise<MarkAllNotificationsReadResult> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updatedCount: count };
  }
}
