import {
  Bell,
  CircleCheck,
  CircleX,
  Package,
  Star,
  Store,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

import type { NotificationIcon } from '../notification-display';

// Khoá icon (hàm thuần `describeNotification` trả khoá, không trả component) → biểu tượng lucide. `Record` đầy đủ theo
// `NotificationIcon`: thêm khoá icon mới mà quên ánh xạ ở đây là lỗi biên dịch.
const ICONS: Record<NotificationIcon, LucideIcon> = {
  order: Package,
  shipping: Truck,
  cancelled: CircleX,
  completed: CircleCheck,
  refund: Undo2,
  review: Star,
  shop: Store,
  info: Bell,
};

// Chỉ trang trí (`aria-hidden`): tiêu đề và nội dung đã mang đủ ý nghĩa cho trình đọc màn hình.
export function NotificationIconGlyph({
  icon,
  className,
}: {
  icon: NotificationIcon;
  className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" className={className ?? 'size-4'} />;
}
