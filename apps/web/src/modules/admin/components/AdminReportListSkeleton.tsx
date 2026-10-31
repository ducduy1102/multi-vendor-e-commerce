import { Skeleton } from '@/shared/components/ui/skeleton';

import {
  ADMIN_REPORT_LAYOUT_CLASS,
  ADMIN_REPORT_LIST_CLASS,
} from './admin-report-layout.constants';

const ROW_COUNT = 5;

// Khung chờ đúng hình hàng đợi thật: cùng lưới hai cột, mỗi dòng có ô biểu tượng 32px + hai dòng chữ + huy hiệu, khung xem nhanh chỉ có từ `xl`.
// Trang trí (`aria-hidden`); vùng bọc `aria-busy` + chữ `sr-only` do Container lo (rules/frontend.md mục 10).
export function AdminReportListSkeleton() {
  return (
    <div className={ADMIN_REPORT_LAYOUT_CLASS} aria-hidden="true">
      <div className={ADMIN_REPORT_LIST_CLASS}>
        <ul className="divide-y divide-border">
          {Array.from({ length: ROW_COUNT }, (_, index) => (
            <li key={index} className="flex items-start gap-3 px-3 py-3">
              <Skeleton className="size-8 shrink-0 rounded-lg motion-reduce:animate-none" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
              </div>
              <Skeleton className="h-5 w-12 shrink-0 rounded-4xl motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden xl:block">
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="h-9 w-full motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
