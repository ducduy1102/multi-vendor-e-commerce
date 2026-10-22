import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as notificationService from '../services/notification.service';
import { markAllNotificationsReadInCache } from './notification-cache';
import {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
} from './notification-query-keys';

// Đánh dấu TẤT CẢ đã đọc. LẠC QUAN: mọi dòng đã đọc, tab "Chưa đọc" rỗng và huy hiệu về 0 NGAY. Lỗi ⇒ tải lại danh
// sách; xong ⇒ tải lại huy hiệu (thông báo tới giữa chừng không bị xoá oan khỏi số đếm). Server idempotent.
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onMutate: () => {
      markAllNotificationsReadInCache(queryClient, new Date().toISOString());
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LIST_QUERY_KEY });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_UNREAD_COUNT_QUERY_KEY });
    },
  });
}
