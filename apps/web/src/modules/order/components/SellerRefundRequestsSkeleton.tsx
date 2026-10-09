import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  SELLER_REFUND_GRID_CLASS,
  SELLER_REFUND_ROW_CLASS,
  SELLER_REFUND_TABLE_CLASS,
} from './seller-refund-request-row.constants';
import { SellerRefundRequestsHeader } from './SellerRefundRequestsHeader';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface SellerRefundRequestsSkeletonProps {
  count?: number;
}

// Khớp bố cục bảng thật (cùng khung, cùng template cột, cùng dòng tiêu đề) để không nhảy layout khi dữ liệu về.
// Chỉ mang tính trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function SellerRefundRequestsSkeleton({ count = 4 }: SellerRefundRequestsSkeletonProps) {
  return (
    <div aria-hidden="true" className={SELLER_REFUND_TABLE_CLASS}>
      <SellerRefundRequestsHeader />
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={cn(SELLER_REFUND_GRID_CLASS, SELLER_REFUND_ROW_CLASS)}>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-32', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-40', SKELETON_CLASS)} />
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
