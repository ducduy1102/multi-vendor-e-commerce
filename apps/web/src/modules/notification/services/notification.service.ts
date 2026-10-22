import {
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationListSchema,
  notificationUnreadCountSchema,
  type MarkAllNotificationsReadResult,
  type MarkNotificationReadResult,
  type NotificationList,
  type NotificationUnreadCount,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Mọi route thông báo đều bắt buộc đăng nhập và chỉ trả thông báo CỦA CHÍNH người gọi (BE: JwtAuthGuard, không route nào
// nhận userId từ client) nên service không có tham số "của ai". Id đi qua encodeURIComponent: không tin nó không chứa
// ký tự đặc biệt. Response nào cũng đi qua Zod: thông báo loại lạ/dữ liệu hỏng rơi về `UNKNOWN` ngay ở schema đọc, nên
// một phần tử hỏng không làm hỏng cả danh sách.
const BASE_PATH = '/notifications';

export interface ListNotificationsParams {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}

function withQuery(path: string, params: ListNotificationsParams): string {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  // Mặc định của BE là "false": chỉ gửi khi bật, URL "Tất cả" không mang tham số thừa.
  if (params.unreadOnly) query.set('unreadOnly', 'true');
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

// Hộp thông báo, MỚI NHẤT trước, phân trang theo con trỏ mờ `cursor` (= `nextCursor` của trang trước).
export async function listNotifications(
  params: ListNotificationsParams = {},
): Promise<NotificationList> {
  const data = await apiFetch<unknown>(withQuery(BASE_PATH, params), { method: 'GET' });
  return notificationListSchema.parse(data);
}

// Số chưa đọc CHÍNH XÁC (không trần) cho huy hiệu; hiển thị "99+" là việc của giao diện.
export async function getUnreadCount(): Promise<NotificationUnreadCount> {
  const data = await apiFetch<unknown>(`${BASE_PATH}/unread-count`, { method: 'GET' });
  return notificationUnreadCountSchema.parse(data);
}

// Đánh dấu MỘT thông báo đã đọc. Idempotent: đã đọc rồi thì BE trả đúng mốc cũ, không ghi đè. Của người khác hay không
// tồn tại ⇒ 404 chung (không phân biệt).
export async function markRead(id: string): Promise<MarkNotificationReadResult> {
  const data = await apiFetch<unknown>(`${BASE_PATH}/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
  return markNotificationReadResultSchema.parse(data);
}

// Đánh dấu TẤT CẢ đã đọc. Idempotent: lần gọi sau trả `updatedCount: 0`.
export async function markAllRead(): Promise<MarkAllNotificationsReadResult> {
  const data = await apiFetch<unknown>(`${BASE_PATH}/read-all`, { method: 'POST' });
  return markAllNotificationsReadResultSchema.parse(data);
}
