import { notificationSchema, type Notification } from '@ecommerce/types';

// Hàng `notifications` ở DB → phần tử của response / payload `notification:new`. Dùng chung cho bên ghi (đẩy real-time
// sau khi ghi) và bên đọc (modules/notification, Week10.md 7.6) để hai nơi không bao giờ lệch hình dạng.
export interface NotificationRow {
  id: string;
  type: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}

// Đi qua `notificationSchema` (schema ĐỌC): loại đã biết với dữ liệu đúng hình dạng thì giữ nguyên; loại lạ hoặc dữ liệu
// sai hình dạng (dữ liệu cũ, hàng bị sửa tay) rơi về `{ type: 'UNKNOWN', data: {} }` — dữ liệu không được kiểm không
// bao giờ ra khỏi API. Không ném: nhánh UNKNOWN nhận mọi `type` ≤ 64 ký tự (CHECK ở DB bảo đảm).
export function toNotificationDto(row: NotificationRow): Notification {
  return notificationSchema.parse({
    id: row.id,
    type: row.type,
    data: row.data,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
}
