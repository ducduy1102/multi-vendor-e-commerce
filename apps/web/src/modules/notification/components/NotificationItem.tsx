'use client';

import { useFormatter } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/shared/lib/utils';

import { useNotificationText } from '../hooks/useNotificationText';
import { describeNotification } from '../notification-display';
import type { Notification } from '../types';
import {
  NOTIFICATION_ICON_WRAPPER_CLASS,
  NOTIFICATION_ROW_CLASS,
} from './notification-layout.constants';
import { NotificationIconGlyph } from './NotificationIconGlyph';

// Dưới ngưỡng này hiện "Vừa xong" thay vì "30 giây trước": "bây giờ" của trang chỉ nhích mỗi phút (useNow) nên số giây
// sẽ đứng yên và sai.
const JUST_NOW_MS = 60_000;

interface NotificationItemProps {
  notification: Notification;
  // "Bây giờ" (ms) để dựng nhãn thời gian tương đối.
  now: number;
  // Gọi khi người dùng bấm vào dòng (chỉ nhiệm vụ đánh dấu đã đọc; điều hướng do `<Link>` đảm nhiệm).
  onOpen: (notification: Notification) => void;
}

// Một dòng thông báo: icon, tiêu đề, nội dung, thời gian tương đối, chấm chưa đọc. Có đường dẫn đích ⇒ là `<Link>` thật
// (chuột giữa/mở tab mới đúng ngữ nghĩa); không có (loại lạ, id hỏng) ⇒ `<button>` chỉ đánh dấu đã đọc. Tên shop/sản phẩm/lý do
// là chữ người dùng nhập: luôn render như text (không `dangerouslySetInnerHTML`), nội dung xuống dòng được
// (`[overflow-wrap:anywhere]` — khác `break-words`, chỉ `anywhere` mới thu nhỏ min-content) và cắt 3 dòng kèm `title`
// mang bản đầy đủ. Chưa đọc: nền nhẹ + chữ đậm + chấm + chữ "Chưa đọc" cho trình đọc màn hình (chấm là `aria-hidden`).
export function NotificationItem({ notification, now, onOpen }: NotificationItemProps) {
  const t = useNotificationText();
  const format = useFormatter();
  const display = describeNotification(notification);
  const isUnread = notification.readAt === null;

  const title = t(display.titleKey, display.params);
  const body = t(display.bodyKey, display.params);

  const createdAt = new Date(notification.createdAt);
  const timeLabel =
    now - createdAt.getTime() < JUST_NOW_MS
      ? t('timeJustNow')
      : format.relativeTime(createdAt, now);
  const fullTime = format.dateTime(createdAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const rowClass = cn(
    NOTIFICATION_ROW_CLASS,
    'transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
    isUnread && 'bg-primary/5',
  );

  // Chữ phụ (nội dung, thời gian): `text-muted-foreground` (0,556) trên nền `bg-primary/5` của dòng CHƯA ĐỌC chỉ đạt 4,42:1 ở
  // chế độ sáng (< 4,5:1 của WCAG AA; đo bằng trình duyệt thật, Week10.md 9.3) và trên `bg-muted` khi hover/focus chỉ 4,35:1
  // (trên nền trắng vẫn 4,74:1). Giữ nguyên token và nền, chỉ đậm chữ ở đúng các trạng thái có nền pha màu
  // (rules/frontend.md mục 5). jsdom không tính được màu Tailwind nên unit test chỉ khoá cặp lớp.
  const secondaryTextClass = cn(
    isUnread ? 'text-foreground/75' : 'text-muted-foreground',
    'group-hover:text-foreground/75 group-focus-visible:text-foreground/75',
  );

  const content = (
    <>
      <span className={NOTIFICATION_ICON_WRAPPER_CLASS}>
        <NotificationIconGlyph icon={display.icon} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {isUnread ? <span className="sr-only">{t('unreadSr')}</span> : null}
        <span
          title={title}
          className={cn(
            'text-sm [overflow-wrap:anywhere] text-foreground',
            isUnread ? 'font-semibold' : 'font-medium',
          )}
        >
          {title}
        </span>
        <span
          title={body}
          className={cn('line-clamp-3 text-sm [overflow-wrap:anywhere]', secondaryTextClass)}
        >
          {body}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1.5">
        <time
          dateTime={notification.createdAt}
          title={fullTime}
          className={cn('text-xs whitespace-nowrap', secondaryTextClass)}
        >
          {timeLabel}
        </time>
        {isUnread ? (
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        ) : (
          <span aria-hidden="true" className="size-2" />
        )}
      </span>
    </>
  );

  return (
    <li>
      {display.href ? (
        <Link
          href={display.href}
          onClick={() => onOpen(notification)}
          className={cn('group', rowClass)}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(notification)}
          className={cn('group cursor-pointer', rowClass)}
        >
          {content}
        </button>
      )}
    </li>
  );
}
