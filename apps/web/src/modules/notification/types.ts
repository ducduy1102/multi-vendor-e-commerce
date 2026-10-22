// Type request/response của module notification, dùng chung qua @ecommerce/types (định nghĩa một lần ở packages/types).
export type {
  KnownNotification,
  MarkAllNotificationsReadResult,
  MarkNotificationReadResult,
  Notification,
  NotificationList,
  NotificationNewEvent,
  NotificationType,
  NotificationUnreadCount,
  UnknownNotification,
} from '@ecommerce/types';

// Bộ lọc của trang `/notifications` (tab "Tất cả" / "Chưa đọc"): mỗi bộ lọc là một danh sách riêng trong cache.
export type NotificationFilter = 'all' | 'unread';
