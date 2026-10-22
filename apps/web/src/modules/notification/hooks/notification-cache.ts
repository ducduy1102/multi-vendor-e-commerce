import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type {
  Notification,
  NotificationFilter,
  NotificationList,
  NotificationUnreadCount,
} from '../types';
import {
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';

// Các thay đổi cache của hộp thông báo, tách khỏi hook để test không cần React/socket. QUY TẮC (cùng chat-cache): chỉ
// `setQueryData` lên cache ĐÃ nạp — updater trả `undefined` thì TanStack Query KHÔNG tạo dữ liệu, nên ghi vào một danh
// sách chưa từng nạp không tạo ra "dữ liệu" giả một phần khiến `useInfiniteQuery` bỏ qua lần nạp đầu.

export type NotificationsData = InfiniteData<NotificationList, string | undefined>;

const FILTERS: readonly NotificationFilter[] = ['all', 'unread'];

function containsNotification(data: NotificationsData, id: string): boolean {
  return data.pages.some((page) => page.items.some((item) => item.id === id));
}

// Thông báo MỚI (từ real-time) vào ĐẦU trang đầu của mọi danh sách đã nạp. Idempotent: đã có (theo id) ở BẤT KỲ trang
// nào thì không chèn lại — sự kiện và lần tải lại có thể mang cùng một thông báo theo bất kỳ thứ tự nào. Danh sách
// "Chưa đọc" chỉ nhận thông báo chưa đọc.
export function prependNotification(queryClient: QueryClient, notification: Notification): void {
  for (const filter of FILTERS) {
    if (filter === 'unread' && notification.readAt !== null) continue;
    queryClient.setQueryData<NotificationsData>(notificationListQueryKey(filter), (data) => {
      if (!data || containsNotification(data, notification.id)) return data;
      const [first, ...rest] = data.pages;
      if (!first) return data;
      return { ...data, pages: [{ ...first, items: [notification, ...first.items] }, ...rest] };
    });
  }
}

// Một thông báo đã đọc (lạc quan): ở "Tất cả" đặt `readAt`, ở "Chưa đọc" GỠ khỏi danh sách (danh sách đó chỉ chứa thông
// báo chưa đọc). Trả `wasUnread` = có thấy nó ở trạng thái chưa đọc trong cache hay không, để nơi gọi trừ đúng số ở
// huy hiệu — không thấy (danh sách chưa nạp) thì không biết, huy hiệu sẽ được tải lại sau khi lệnh xong.
export function markNotificationReadInCache(
  queryClient: QueryClient,
  id: string,
  readAt: string,
): { wasUnread: boolean } {
  let wasUnread = false;

  queryClient.setQueryData<NotificationsData>(notificationListQueryKey('all'), (data) => {
    if (!data) return data;
    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page.items.some((item) => item.id === id && item.readAt === null)) return page;
      changed = true;
      wasUnread = true;
      return {
        ...page,
        items: page.items.map((item) => (item.id === id ? { ...item, readAt } : item)),
      };
    });
    return changed ? { ...data, pages } : data;
  });

  queryClient.setQueryData<NotificationsData>(notificationListQueryKey('unread'), (data) => {
    if (!data) return data;
    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page.items.some((item) => item.id === id)) return page;
      changed = true;
      wasUnread = true;
      return { ...page, items: page.items.filter((item) => item.id !== id) };
    });
    return changed ? { ...data, pages } : data;
  });

  return { wasUnread };
}

// Tất cả đã đọc (lạc quan): "Tất cả" đặt `readAt` cho mọi dòng chưa đọc, "Chưa đọc" về rỗng (một trang rỗng, hết con
// trỏ — nếu giữ `nextCursor` giao diện sẽ hiện nút "Tải thêm" trên một danh sách rỗng).
export function markAllNotificationsReadInCache(queryClient: QueryClient, readAt: string): void {
  queryClient.setQueryData<NotificationsData>(notificationListQueryKey('all'), (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
      })),
    };
  });

  queryClient.setQueryData<NotificationsData>(notificationListQueryKey('unread'), (data) => {
    if (!data) return data;
    return { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] };
  });

  setUnreadCount(queryClient, 0);
}

// Huy hiệu: chỉnh một lượng tương đối (không xuống dưới 0). Chỉ chỉnh khi huy hiệu ĐÃ nạp.
export function adjustUnreadCount(queryClient: QueryClient, delta: number): void {
  queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, (data) =>
    data ? { unreadCount: Math.max(0, data.unreadCount + delta) } : data,
  );
}

export function setUnreadCount(queryClient: QueryClient, count: number): void {
  queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, (data) =>
    data ? { unreadCount: Math.max(0, count) } : data,
  );
}
