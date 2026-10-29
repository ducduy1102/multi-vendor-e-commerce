import {
  HandCoins,
  LayoutDashboard,
  MessageSquareWarning,
  ReceiptText,
  Scale,
  Store,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { buildAdminRefundsHref } from './admin-refunds-href';
import { buildAdminShopsHref } from './admin-shops-href';
import type { AdminOverview } from './types';

// Bảng hiển thị của trang tổng quan và thanh điều hướng Admin (Week11.md 2.6). Hàm thuần + hằng số, không React:
// test được bằng vitest không cần render.

// Chỉ hiện "99+" ở chỗ hẹp (thanh điều hướng); thẻ ở trang tổng quan hiện số đúng.
const MAX_NAV_COUNT = 99;

export function formatAdminNavCount(count: number): string {
  return count > MAX_NAV_COUNT ? `${MAX_NAV_COUNT}+` : String(count);
}

// --- Hàng chờ (thẻ ở /admin) -------------------------------------------------------------------------------------

export type AdminQueueKey = keyof AdminOverview;

export interface AdminQueueDefinition {
  key: AdminQueueKey;
  icon: LucideIcon;
  // Khoá i18n (namespace `admin`).
  titleKey: string;
  captionKey: string;
  // Đích của thẻ: đúng tab / bộ lọc mà số đếm này lấy `total` (BE: GET /admin/overview). Dựng bằng chính các hàm
  // dựng URL của hai trang đích nên không thể trỏ tới route hay bộ lọc không tồn tại; test khoá từng đích.
  href: string;
}

// Thứ tự = độ gấp: việc dính tiền của người mua (khiếu nại đã lên sàn, hoàn tiền lỗi, thanh toán cần hoàn) trước, shop
// chờ duyệt sau (seller chờ nhưng không có tiền nào bị giữ).
export const ADMIN_OVERVIEW_QUEUES: readonly AdminQueueDefinition[] = [
  {
    key: 'escalatedRefundRequests',
    icon: Scale,
    titleKey: 'overviewQueueDisputes',
    captionKey: 'overviewQueueDisputesCaption',
    href: buildAdminRefundsHref({ tab: 'disputes' }),
  },
  {
    key: 'refundsNeedingAction',
    icon: Undo2,
    titleKey: 'overviewQueueFailed',
    captionKey: 'overviewQueueFailedCaption',
    href: buildAdminRefundsHref({ tab: 'failed' }),
  },
  {
    key: 'refundablePayments',
    icon: ReceiptText,
    titleKey: 'overviewQueuePayments',
    captionKey: 'overviewQueuePaymentsCaption',
    href: buildAdminRefundsHref({ tab: 'payments' }),
  },
  {
    key: 'pendingShops',
    icon: Store,
    titleKey: 'overviewQueueShops',
    captionKey: 'overviewQueueShopsCaption',
    href: buildAdminShopsHref(),
  },
];

export function hasAnyAdminWork(overview: AdminOverview): boolean {
  return ADMIN_OVERVIEW_QUEUES.some((queue) => overview[queue.key] > 0);
}

// --- Thanh điều hướng --------------------------------------------------------------------------------------------

export interface AdminNavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  // `/admin` là tiền tố của mọi mục còn lại nên phải so khớp tuyệt đối, nếu không nó luôn sáng.
  exact: boolean;
  // Số việc chờ của khu này; null = mục không có số (Tổng quan).
  count: (overview: AdminOverview) => number | null;
}

// Chỉ liệt kê trang ĐÃ CÓ (không link tới trang chưa tồn tại). Báo cáo... thêm vào đây khi trang tương ứng có. "Kháng nghị" (4.6) đứng
// CUỐI để không đụng thứ tự đã chốt ở 3.5 ("Người dùng" ngay sau "Shop").
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    href: '/admin',
    labelKey: 'navOverview',
    icon: LayoutDashboard,
    exact: true,
    count: () => null,
  },
  {
    href: '/admin/shops',
    labelKey: 'navShops',
    icon: Store,
    exact: false,
    count: (overview) => overview.pendingShops,
  },
  {
    href: '/admin/users',
    labelKey: 'navUsers',
    icon: Users,
    exact: false,
    // Người dùng không có hàng chờ nên không có số trên nav (không hiện số tổng — đó không phải việc cần xử lý).
    count: () => null,
  },
  {
    href: '/admin/refunds',
    labelKey: 'navRefunds',
    icon: HandCoins,
    exact: false,
    count: (overview) =>
      overview.escalatedRefundRequests +
      overview.refundsNeedingAction +
      overview.refundablePayments,
  },
  {
    href: '/admin/appeals',
    labelKey: 'navAppeals',
    icon: MessageSquareWarning,
    exact: false,
    // Chưa có số kháng nghị chờ trong /admin/overview (BE không đếm) nên mục này không có số trên nav; Admin được báo bằng thông báo
    // ADMIN_APPEAL_PENDING (chuông + toast).
    count: () => null,
  },
];

export function isAdminNavItemActive(item: AdminNavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
