import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import type { AdminAppealListFilter } from '../types';
import {
  ADMIN_APPEAL_ACTIONS_CLASS,
  ADMIN_APPEAL_FULL_ROW_CELL_CLASS,
  ADMIN_APPEAL_GRID_CLASS,
  ADMIN_APPEAL_ROW_CLASS,
  ADMIN_APPEAL_TABLE_CLASS,
} from './admin-appeal-row.constants';
import { ADMIN_SHOP_LOGO_CLASS } from './admin-shop-row.constants';
import { AdminAppealListHeader } from './AdminAppealListHeader';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface AdminAppealListSkeletonProps {
  // Tab đang tải — chỉ tab "Chờ xử lý" có nút hành động, nên chỉ tab đó vẽ khung nút.
  status: AdminAppealListFilter;
  count?: number;
}

// Khớp bố cục bảng thật (cùng khung, cùng template cột, cùng dòng tiêu đề) để không nhảy layout khi dữ liệu về. Chỉ mang tính
// trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function AdminAppealListSkeleton({ status, count = 5 }: AdminAppealListSkeletonProps) {
  const hasActions = status === 'PENDING';

  return (
    <div aria-hidden="true" className={ADMIN_APPEAL_TABLE_CLASS}>
      <AdminAppealListHeader />
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={cn(ADMIN_APPEAL_GRID_CLASS, ADMIN_APPEAL_ROW_CLASS)}>
            <div className={cn('flex items-center gap-3', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}>
              <Skeleton className={cn(ADMIN_SHOP_LOGO_CLASS, SKELETON_CLASS)} />
              <div className="flex flex-col gap-1.5">
                <Skeleton className={cn('h-4 w-32', SKELETON_CLASS)} />
                <Skeleton className={cn('h-3 w-24', SKELETON_CLASS)} />
                <Skeleton className={cn('h-3 w-36', SKELETON_CLASS)} />
              </div>
            </div>
            <div className={cn('flex flex-col gap-1.5', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}>
              <Skeleton className={cn('h-4 w-full', SKELETON_CLASS)} />
              <Skeleton className={cn('h-4 w-full', SKELETON_CLASS)} />
              <Skeleton className={cn('h-4 w-2/3', SKELETON_CLASS)} />
            </div>
            <Skeleton className={cn('h-4 w-20', SKELETON_CLASS)} />
            <Skeleton
              className={cn(
                'h-5 w-24 rounded-4xl',
                ADMIN_APPEAL_FULL_ROW_CELL_CLASS,
                SKELETON_CLASS,
              )}
            />
            {/* Cùng ô như dòng thật: rỗng ⇒ ẩn (`empty:hidden`), nên tab không có nút không để lại khoảng trống. */}
            <div
              className={cn('flex min-w-0 flex-col empty:hidden', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}
            >
              {hasActions ? (
                <div className={ADMIN_APPEAL_ACTIONS_CLASS}>
                  <Skeleton className={cn('h-9 w-24 lg:w-full', SKELETON_CLASS)} />
                  <Skeleton className={cn('h-9 w-20 lg:w-full', SKELETON_CLASS)} />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
