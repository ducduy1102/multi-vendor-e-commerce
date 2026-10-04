import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_SHOP_GRID_CLASS,
  ADMIN_SHOP_LOGO_CLASS,
  ADMIN_SHOP_ROW_CLASS,
  ADMIN_SHOP_TABLE_CLASS,
} from './admin-shop-row.constants';
import type { ShopStatus } from '../types';
import { AdminShopListHeader } from './AdminShopListHeader';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface AdminShopListSkeletonProps {
  // Tab đang tải — để dòng tiêu đề cột giống hệt bảng thật (nhãn cột ngày đổi theo tab).
  status: ShopStatus;
  count?: number;
}

// Khớp bố cục bảng thật (cùng khung, cùng template cột, cùng dòng tiêu đề) để không nhảy layout khi
// dữ liệu về. Chỉ mang tính trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function AdminShopListSkeleton({ status, count = 5 }: AdminShopListSkeletonProps) {
  return (
    <div aria-hidden="true" className={ADMIN_SHOP_TABLE_CLASS}>
      <AdminShopListHeader status={status} />
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className={cn(ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_ROW_CLASS)}>
            <div className="flex items-center gap-3">
              <Skeleton className={cn(ADMIN_SHOP_LOGO_CLASS, SKELETON_CLASS)} />
              <div className="flex flex-col gap-1.5">
                <Skeleton className={cn('h-4 w-32', SKELETON_CLASS)} />
                <Skeleton className={cn('h-3 w-20', SKELETON_CLASS)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn('h-4 w-28', SKELETON_CLASS)} />
              <Skeleton className={cn('h-3 w-40', SKELETON_CLASS)} />
            </div>
            <Skeleton className={cn('h-4 w-20', SKELETON_CLASS)} />
            <Skeleton className={cn('h-5 w-20 rounded-4xl', SKELETON_CLASS)} />
            <div className="flex gap-2 md:justify-end">
              <Skeleton className={cn('h-8 w-16', SKELETON_CLASS)} />
              <Skeleton className={cn('h-8 w-20', SKELETON_CLASS)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
