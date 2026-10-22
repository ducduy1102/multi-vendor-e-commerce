// Barrel export cho module notification — chỉ những gì cần dùng ở app/ và (qua shared/) ghép với Header/layout.
export {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './hooks/notification-query-keys';
export { useMarkAllNotificationsRead } from './hooks/useMarkAllNotificationsRead';
export { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
export { useNotificationRealtimeSync } from './hooks/useNotificationRealtimeSync';
export { useNotifications } from './hooks/useNotifications';
export { useUnreadNotificationCount } from './hooks/useUnreadNotificationCount';
export * as notificationService from './services/notification.service';
export type {
  KnownNotification,
  MarkAllNotificationsReadResult,
  MarkNotificationReadResult,
  Notification,
  NotificationFilter,
  NotificationList,
  NotificationNewEvent,
  NotificationType,
  NotificationUnreadCount,
  UnknownNotification,
} from './types';
