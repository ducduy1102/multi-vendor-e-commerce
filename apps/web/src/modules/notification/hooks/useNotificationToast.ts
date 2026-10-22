'use client';

import { toast } from 'sonner';

import { usePathname, useRouter } from '@/i18n/navigation';

import { describeNotification } from '../notification-display';
import { shouldToastNotification } from '../notification-toast';
import type { Notification } from '../types';
import { useMarkNotificationRead } from './useMarkNotificationRead';
import { useNotificationText } from './useNotificationText';

// Trả về hàm hiện toast cho một thông báo MỚI tới (gắn vào `onNew` của useNotificationRealtimeSync). Chỉ hiện khi:
//  - loại đáng toast (`shouldToastNotification` — không toast mọi thứ);
//  - tab đang HIỂN THỊ (tab nền không cần toast: người dùng sẽ thấy huy hiệu khi quay lại);
//  - không đang ở chính trang `/notifications` (dòng mới đã hiện ở đầu danh sách, toast chỉ lặp lại).
// `id` của toast = id thông báo: cùng một thông báo tới hai lần (sự kiện + tải lại) chỉ thay toast cũ, không nhân đôi.
// Nút "Xem" (chỉ khi có đường dẫn đích) đánh dấu đã đọc rồi điều hướng. Chữ lấy từ `describeNotification` đi vào tham số
// dịch và sonner render như text.
export function useNotificationToast(): (notification: Notification) => void {
  const t = useNotificationText();
  const router = useRouter();
  const pathname = usePathname();
  const markRead = useMarkNotificationRead();

  return (notification) => {
    if (!shouldToastNotification(notification)) return;
    if (document.visibilityState !== 'visible') return;
    if (pathname === '/notifications') return;

    const display = describeNotification(notification);
    const { href } = display;
    toast(t(display.titleKey, display.params), {
      id: notification.id,
      description: t(display.bodyKey, display.params),
      action: href
        ? {
            label: t('toastView'),
            onClick: () => {
              markRead.mutate(notification.id);
              router.push(href);
            },
          }
        : undefined,
    });
  };
}
