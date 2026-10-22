import type { NotificationFilter } from '../types';

// Mọi query key của module notification khai ở ĐÂY (một chỗ duy nhất, như chat-query-keys.ts) — hook đọc, hook mutation
// và bộ xử lý real-time dùng chung nên không bao giờ gõ tay hai nơi rồi lệch nhau.

// Tiền tố của MỌI query thông báo (thông báo thuộc về người đang đăng nhập nên không cần phạm vi như chat). Làm mới tiền
// tố này (sau khi nối lại real-time) kéo theo cả hai danh sách và huy hiệu.
export const NOTIFICATION_QUERY_KEY = ['notification'] as const;

// Tiền tố của các danh sách (cả hai bộ lọc).
export const NOTIFICATION_LIST_QUERY_KEY = [...NOTIFICATION_QUERY_KEY, 'list'] as const;

export function notificationListQueryKey(filter: NotificationFilter) {
  return [...NOTIFICATION_LIST_QUERY_KEY, filter] as const;
}

export const NOTIFICATION_UNREAD_COUNT_QUERY_KEY = [...NOTIFICATION_QUERY_KEY, 'unread'] as const;
