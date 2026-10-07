import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  ORDER_CARD_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_CARD_ITEM_ROW_CLASS,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_GRID_CLASS,
  ORDER_DETAIL_SECTION_BODY_CLASS,
  ORDER_DETAIL_SECTION_TITLE_CLASS,
  ORDER_ITEM_THUMB_CLASS,
} from './order-card.constants';

const SKELETON_CLASS = 'motion-reduce:animate-none';

function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className={ORDER_CARD_CLASS}>
      <div className={ORDER_DETAIL_SECTION_TITLE_CLASS}>
        <Skeleton className={cn('h-5 w-28', SKELETON_CLASS)} />
      </div>
      {children}
    </div>
  );
}

// Khớp bố cục OrderDetailView (cùng hằng số lưới/khối/dòng/ảnh) để không nhảy layout khi dữ liệu
// về. Chỉ trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only đã dịch.
export function OrderDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className={ORDER_CARD_CLASS}>
        <div className={ORDER_CARD_HEADER_CLASS}>
          <Skeleton className={cn('h-5 w-40', SKELETON_CLASS)} />
          <Skeleton className={cn('h-5 w-20 rounded-4xl', SKELETON_CLASS)} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 py-2.5 sm:px-4">
          <Skeleton className={cn('h-4 w-3/4 max-w-sm', SKELETON_CLASS)} />
          <Skeleton className={cn('h-4 w-40', SKELETON_CLASS)} />
        </div>
      </div>

      <div className={ORDER_DETAIL_GRID_CLASS}>
        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <SectionSkeleton>
            {[0, 1].map((row) => (
              <div
                key={row}
                className={cn(ORDER_CARD_ITEM_ROW_CLASS, 'border-b border-border last:border-b-0')}
              >
                <Skeleton className={cn(ORDER_ITEM_THUMB_CLASS, SKELETON_CLASS)} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className={cn('h-4 w-3/4', SKELETON_CLASS)} />
                  <Skeleton className={cn('h-3 w-1/3', SKELETON_CLASS)} />
                </div>
                <Skeleton className={cn('h-4 w-16 shrink-0', SKELETON_CLASS)} />
              </div>
            ))}
          </SectionSkeleton>
          <SectionSkeleton>
            <div className={cn(ORDER_DETAIL_SECTION_BODY_CLASS, 'flex flex-col gap-4')}>
              {[0, 1, 2].map((step) => (
                <div key={step} className="flex gap-3">
                  <Skeleton
                    className={cn('mt-1 size-[11px] shrink-0 rounded-full', SKELETON_CLASS)}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className={cn('h-4 w-48', SKELETON_CLASS)} />
                    <Skeleton className={cn('h-3 w-32', SKELETON_CLASS)} />
                  </div>
                </div>
              ))}
            </div>
          </SectionSkeleton>
        </div>

        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <SectionSkeleton>
            <div className={cn(ORDER_DETAIL_SECTION_BODY_CLASS, 'flex flex-col gap-2')}>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center justify-between gap-3">
                  <Skeleton className={cn('h-4 w-24', SKELETON_CLASS)} />
                  <Skeleton className={cn('h-4 w-20', SKELETON_CLASS)} />
                </div>
              ))}
            </div>
          </SectionSkeleton>
          <SectionSkeleton>
            <div className={cn(ORDER_DETAIL_SECTION_BODY_CLASS, 'flex flex-col gap-1.5')}>
              <Skeleton className={cn('h-4 w-32', SKELETON_CLASS)} />
              <Skeleton className={cn('h-4 w-28', SKELETON_CLASS)} />
              <Skeleton className={cn('h-4 w-full', SKELETON_CLASS)} />
            </div>
          </SectionSkeleton>
        </div>
      </div>
    </div>
  );
}
