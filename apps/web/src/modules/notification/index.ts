// Barrel export cho module notification — chỉ những gì cần dùng ở app/ và (qua shared/) ghép với Header/layout.
export { NotificationsContainer } from './components/NotificationsContainer';
export { NotificationListSkeleton } from './components/NotificationListSkeleton';
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
export { useNotificationToast } from './hooks/useNotificationToast';
export { useUnreadNotificationCount } from './hooks/useUnreadNotificationCount';
export { describeNotification } from './notification-display';
export {
  DEFAULT_NOTIFICATION_TAB,
  NOTIFICATION_TABS,
  buildNotificationsHref,
  parseNotificationsPageQuery,
  type NotificationTab,
} from './notification-page-query';
export { shouldToastNotification } from './notification-toast';
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
