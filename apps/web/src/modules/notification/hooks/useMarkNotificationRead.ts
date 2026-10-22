import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as notificationService from '../services/notification.service';
import { adjustUnreadCount, markNotificationReadInCache } from './notification-cache';
import {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
} from './notification-query-keys';

// Đánh dấu MỘT thông báo đã đọc. LẠC QUAN: dòng đó đã đọc (và rời tab "Chưa đọc") và huy hiệu giảm 1 NGAY, không chờ
// phản hồi. Lỗi ⇒ tải lại các danh sách để lấy lại trạng thái đúng của server. Xong (thành công hay lỗi) ⇒ tải lại huy
// hiệu: nếu thông báo không nằm trong danh sách đã nạp (bấm từ toast) thì chưa trừ được lạc quan, và đây cũng chốt lại
// số đúng khi có thông báo mới tới giữa chừng. Server idempotent nên gọi lặp an toàn.
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onMutate: (id) => {
      const { wasUnread } = markNotificationReadInCache(queryClient, id, new Date().toISOString());
      if (wasUnread) adjustUnreadCount(queryClient, -1);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LIST_QUERY_KEY });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_UNREAD_COUNT_QUERY_KEY });
    },
  });
}
