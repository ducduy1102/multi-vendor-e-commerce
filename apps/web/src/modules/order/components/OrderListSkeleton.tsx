import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  ORDER_CARD_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_CARD_ITEM_ROW_CLASS,
  ORDER_CARD_SUMMARY_CLASS,
  ORDER_ITEM_THUMB_CLASS,
} from './order-card.constants';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface OrderListSkeletonProps {
  count?: number;
}

// Khớp bố cục OrderCard (cùng hằng số class khối/dòng/ảnh) để không nhảy layout khi dữ liệu về.
// Chỉ mang tính trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only đã dịch.
export function OrderListSkeleton({ count = 3 }: OrderListSkeletonProps) {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={ORDER_CARD_CLASS}>
          <div className={ORDER_CARD_HEADER_CLASS}>
            <Skeleton className={cn('h-5 w-32', SKELETON_CLASS)} />
            <Skeleton className={cn('h-5 w-20 rounded-4xl', SKELETON_CLASS)} />
          </div>
          <div className={cn(ORDER_CARD_ITEM_ROW_CLASS, 'border-b border-border')}>
            <Skeleton className={cn(ORDER_ITEM_THUMB_CLASS, SKELETON_CLASS)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-3/4', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-1/3', SKELETON_CLASS)} />
            </div>
            <Skeleton className={cn('h-4 w-16 shrink-0', SKELETON_CLASS)} />
          </div>
          <div className={ORDER_CARD_SUMMARY_CLASS}>
            <Skeleton className={cn('h-4 w-40', SKELETON_CLASS)} />
            <Skeleton className={cn('h-5 w-28', SKELETON_CLASS)} />
          </div>
          <div className={ORDER_CARD_FOOTER_CLASS}>
            <Skeleton className={cn('h-8 w-24', SKELETON_CLASS)} />
            <Skeleton className={cn('ml-auto h-5 w-20', SKELETON_CLASS)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
