import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as notificationService from '../services/notification.service';
import { NOTIFICATION_UNREAD_COUNT_QUERY_KEY } from './notification-query-keys';

// Số thông báo chưa đọc cho huy hiệu ở Header/menu. Giá trị là MỘT SỐ (`data`), không phải object. Huy hiệu hiện ở mọi
// trang nên `enabled` BẮT BUỘC do nơi gọi quyết định (khách vãng lai không được gọi API này — truyền `enabled: false`).
// Mọi nơi gọi hook này dùng chung MỘT truy vấn (khử trùng theo khoá).
export function useUnreadNotificationCount(options: { enabled: boolean }) {
  return useQuery({
    queryKey: NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
    queryFn: notificationService.getUnreadCount,
    select: (data) => data.unreadCount,
    enabled: options.enabled,
    retry: shouldRetryQuery,
  });
}
