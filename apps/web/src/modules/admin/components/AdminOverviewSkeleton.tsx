import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import { ADMIN_OVERVIEW_QUEUES } from '../admin-overview-display';

const SKELETON_CLASS = 'motion-reduce:animate-none';

// Khớp hình thẻ thật (cùng lưới 2×2, cùng padding, ẩn icon/mô tả/dòng link ở mobile như thẻ thật) để không nhảy layout khi
// dữ liệu về. Chỉ trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function AdminOverviewSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3">
      {ADMIN_OVERVIEW_QUEUES.map((queue) => (
        <div
          key={queue.key}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className={cn('size-8 max-sm:hidden', SKELETON_CLASS)} />
            <Skeleton className={cn('h-4 w-24 sm:w-36', SKELETON_CLASS)} />
          </div>
          <Skeleton className={cn('h-9 w-16', SKELETON_CLASS)} />
          <Skeleton className={cn('h-4 w-full max-sm:hidden', SKELETON_CLASS)} />
          <Skeleton className={cn('h-4 w-28 max-sm:hidden', SKELETON_CLASS)} />
        </div>
      ))}
    </div>
  );
}
