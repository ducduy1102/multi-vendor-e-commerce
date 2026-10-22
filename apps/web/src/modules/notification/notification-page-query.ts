// Tab của trang `/notifications`: "Tất cả" (mặc định) hoặc "Chưa đọc", đổi qua `?tab=` trên URL để F5/chia sẻ link/nút
// Back đều giữ đúng tab (cùng kiểu các hàng tab khác, xem shared/lib/tab-link-class.ts).
export const NOTIFICATION_TABS = ['all', 'unread'] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];
export const DEFAULT_NOTIFICATION_TAB: NotificationTab = 'all';

// Khoá dịch của nhãn từng tab (namespace `notification`).
export const NOTIFICATION_TAB_LABEL_KEYS = {
  all: 'tabAll',
  unread: 'tabUnread',
} as const satisfies Record<NotificationTab, string>;

// Đọc `?tab=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: giá trị lạ/thiếu rơi về mặc
// định, không bao giờ ném lỗi làm sập trang; lặp `?tab=a&tab=b` lấy giá trị đầu, cùng cách các trang khác đọc query.
export function parseNotificationsPageQuery(raw: Record<string, string | string[] | undefined>): {
  tab: NotificationTab;
} {
  const value = Array.isArray(raw.tab) ? raw.tab[0] : raw.tab;
  const tab = NOTIFICATION_TABS.find((candidate) => candidate === value);
  return { tab: tab ?? DEFAULT_NOTIFICATION_TAB };
}

// Href của một tab: tab mặc định không mang tham số (URL gọn, và trùng đường dẫn mà Header/menu trỏ tới).
export function buildNotificationsHref(tab: NotificationTab): {
  pathname: '/notifications';
  query: Record<string, string>;
} {
  return {
    pathname: '/notifications',
    query: tab === DEFAULT_NOTIFICATION_TAB ? {} : { tab },
  };
}
