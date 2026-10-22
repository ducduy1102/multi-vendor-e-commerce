'use client';

import { useAuthStore } from '@/modules/auth';
import { useNotificationRealtimeSync, useNotificationToast } from '@/modules/notification';

// Giữ hộp thông báo luôn tươi cho cả phiên bằng sự kiện real-time: thông báo mới ⇒ vào đầu danh sách + hẹn tải lại huy
// hiệu (và toast khi tab đang hiển thị, chỉ cho loại quan trọng), nối lại ⇒ làm mới để lấp khoảng trống (xem
// useNotificationRealtimeSync). Mount MỘT lần ở layout (trong RealtimeProvider) thay vì mỗi nơi tự mount — Header cần huy
// hiệu ở mọi trang, và hai bản cùng chạy chỉ nhân đôi việc (và toast hai lần).
//
// Component này chỉ được nạp động và chỉ dựng khi ĐÃ đăng nhập (lazy-notification.tsx), nên khách vãng lai không tải mã
// thông báo. KHÔNG giao việc dọn dữ liệu riêng tư khi đổi tài khoản cho nó (nạp trễ nên có thể chưa mount kịp): cache thông
// báo nằm trong QueryClient, và `SessionCacheReset` (luôn có mặt) xoá toàn bộ khi đổi người/đăng xuất.
export function NotificationRealtimeSync() {
  const isSignedIn = useAuthStore((state) => state.user !== null);
  const toastNew = useNotificationToast();

  useNotificationRealtimeSync({ enabled: isSignedIn, onNew: toastNew });

  return null;
}
