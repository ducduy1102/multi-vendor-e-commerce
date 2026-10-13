import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import type { AdminRefundTab } from '../admin-refunds-href';
import {
  ADMIN_REFUND_GRID_CLASS,
  ADMIN_REFUND_ROW_CLASS,
  ADMIN_REFUND_TABLE_CLASS,
} from './admin-refund-row.constants';
import { AdminRefundListHeader } from './AdminRefundListHeader';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface AdminRefundListSkeletonProps {
  // Tab đang tải — để dòng tiêu đề cột giống hệt bảng thật (nhãn cột đổi theo tab).
  tab: AdminRefundTab;
  count?: number;
}

// Khớp bố cục bảng thật (cùng khung, cùng template cột, cùng dòng tiêu đề) để không nhảy layout khi dữ liệu về.
// Chỉ mang tính trang trí (aria-hidden) — vùng bọc ở nơi dùng có aria-busy + dòng sr-only.
export function AdminRefundListSkeleton({ tab, count = 4 }: AdminRefundListSkeletonProps) {
  return (
    <div aria-hidden="true" className={ADMIN_REFUND_TABLE_CLASS}>
      <AdminRefundListHeader tab={tab} />
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={cn(ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_ROW_CLASS)}>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-32', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-40', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-28', SKELETON_CLASS)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-28', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-36', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-24', SKELETON_CLASS)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-5 w-24 rounded-4xl', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-36', SKELETON_CLASS)} />
            </div>
            <div className="flex gap-2 md:flex-col">
              <Skeleton className={cn('h-9 w-24 md:w-full', SKELETON_CLASS)} />
              <Skeleton className={cn('h-9 w-20 md:w-full', SKELETON_CLASS)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
