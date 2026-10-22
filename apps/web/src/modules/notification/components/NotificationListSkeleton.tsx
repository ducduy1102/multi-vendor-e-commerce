import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  NOTIFICATION_LIST_FRAME_CLASS,
  NOTIFICATION_ROW_CLASS,
  SKELETON_CLASS,
} from './notification-layout.constants';

interface NotificationListSkeletonProps {
  count?: number;
}

// Khớp bố cục NotificationItem (cùng khung, cùng class dòng, icon size-9) để không nhảy layout khi dữ liệu về. Chỉ trang
// trí (aria-hidden): vùng bọc ở NotificationList có aria-busy + dòng sr-only đã dịch.
export function NotificationListSkeleton({ count = 6 }: NotificationListSkeletonProps) {
  return (
    <ul aria-hidden="true" className={cn(NOTIFICATION_LIST_FRAME_CLASS, 'divide-y divide-border')}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={cn(NOTIFICATION_ROW_CLASS, 'min-h-[4.5rem]')}>
          <Skeleton className={cn('size-9 rounded-full', SKELETON_CLASS)} />
          <span className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className={cn('h-4 w-2/5', SKELETON_CLASS)} />
            <Skeleton className={cn('h-3.5 w-4/5', SKELETON_CLASS)} />
          </span>
          <Skeleton className={cn('h-3 w-10', SKELETON_CLASS)} />
        </li>
      ))}
    </ul>
  );
}
