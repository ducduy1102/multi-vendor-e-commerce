'use client';

import { notificationNewEventSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { RealtimeStatus } from '@/shared/realtime/realtime-client';
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent';
import { useRealtimeStatus } from '@/shared/realtime/useRealtimeStatus';

import type { Notification } from '../types';
import { handleNewNotification } from './notification-realtime-handlers';
import { NOTIFICATION_QUERY_KEY } from './notification-query-keys';

interface UseNotificationRealtimeSyncOptions {
  // Tắt khi chưa đăng nhập (mặc định bật).
  enabled?: boolean;
  // Gọi SAU khi thông báo đã vào cache, cho mỗi thông báo MỚI tới (vd hiện toast). Luôn gọi bản mới nhất, không cần
  // bọc useCallback.
  onNew?: (notification: Notification) => void;
}

// Nối real-time vào cache hộp thông báo (Week10.md 8.1). Gắn MỘT lần ở nơi cần dữ liệu luôn tươi (layout, có huy hiệu ở
// Header) — không mount ở từng trang.
//
//  - `notification:new` ⇒ chèn vào đầu các danh sách đã nạp (khử trùng theo id), hẹn tải lại huy hiệu theo lô.
//    Payload đi qua Zod ở `useRealtimeEvent`: gói sai hình dạng bị bỏ qua im lặng; loại lạ rơi về `UNKNOWN` (vẫn hiện
//    ở danh sách bằng nhãn chung).
//  - SAU MỖI LẦN NỐI (kể cả lần đầu và nối lại sau khi rớt mạng / API ngủ) ⇒ làm mới mọi query thông báo để lấp khoảng
//    trống: sự kiện phát lúc KHÔNG có kết nối không được gửi lại.
//  - MỞ HOOK KHI SOCKET ĐÃ ĐANG KẾT NỐI cũng được coi là một lần nối (làm mới đúng một lần, KHÔNG huỷ truy vấn đang
//    bay): hook được mount trễ bằng `React.lazy` nên có thể bắt đầu nghe SAU khi socket đã nối, và thông báo phát trong
//    khoảng đó bị lỡ. Bật `enabled` khi đang kết nối thì KHÔNG làm mới: query mới tự nạp khi có người dùng nó.
export function useNotificationRealtimeSync(
  options: UseNotificationRealtimeSyncOptions = {},
): void {
  const enabled = options.enabled ?? true;
  const onNew = options.onNew;
  const queryClient = useQueryClient();

  useRealtimeEvent(REALTIME_EVENTS.notificationNew, notificationNewEventSchema, (notification) => {
    if (!enabled) return;
    handleNewNotification(queryClient, notification);
    onNew?.(notification);
  });

  const status = useRealtimeStatus();
  // `null` = hook chưa chạy effect lần nào: lần chạy đầu mà đã đang kết nối là "mount trễ" (xem trên).
  const previousStatus = useRef<RealtimeStatus | null>(null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (enabled && status === 'connected' && previous !== 'connected') {
      void queryClient.invalidateQueries(
        { queryKey: NOTIFICATION_QUERY_KEY },
        // Mount trễ: truy vấn đang nạp lần đầu đã lấy dữ liệu MỚI, không huỷ rồi nạp lại; truy vấn đã xong trước đó mới cần.
        { cancelRefetch: previous !== null },
      );
    }
  }, [status, enabled, queryClient]);
}
