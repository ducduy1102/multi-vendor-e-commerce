import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_USER_GRID_CLASS,
  ADMIN_USER_ROW_CLASS,
  ADMIN_USER_TABLE_CLASS,
} from './admin-user-row.constants';
import { AdminUserListHeader } from './AdminUserListHeader';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface AdminUserListSkeletonProps {
  count?: number;
}

// Khớp bố cục bảng thật (cùng khung, cùng template cột, cùng dòng tiêu đề) để không nhảy layout khi dữ liệu về. Chỉ mang tính
// trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function AdminUserListSkeleton({ count = 6 }: AdminUserListSkeletonProps) {
  return (
    <div aria-hidden="true" className={ADMIN_USER_TABLE_CLASS}>
      <AdminUserListHeader />
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={cn(ADMIN_USER_GRID_CLASS, ADMIN_USER_ROW_CLASS)}>
            <div className="flex items-center gap-3">
              <Skeleton className={cn('size-10 shrink-0 rounded-full', SKELETON_CLASS)} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className={cn('h-4 w-36 max-w-full', SKELETON_CLASS)} />
                <Skeleton className={cn('h-3 w-48 max-w-full', SKELETON_CLASS)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-5 w-20 rounded-4xl', SKELETON_CLASS)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-20', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-14', SKELETON_CLASS)} />
            </div>
            <div className="flex gap-2 md:justify-end">
              <Skeleton className={cn('h-8 w-16', SKELETON_CLASS)} />
              <Skeleton className={cn('size-8', SKELETON_CLASS)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
