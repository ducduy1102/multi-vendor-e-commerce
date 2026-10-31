import { Skeleton } from '@/shared/components/ui/skeleton';

import { ADMIN_REPORT_DETAIL_LAYOUT_CLASS } from './admin-report-layout.constants';

// Khung chờ đúng hình trang chi tiết: tiêu đề, hai thẻ nội dung bên trái, panel Xử lý bên phải (từ `xl`). Trang trí (`aria-hidden`); vùng
// bọc `aria-busy` + chữ `sr-only` do Container lo.
export function AdminReportDetailSkeleton() {
  const card = (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-4 w-1/4 motion-reduce:animate-none" />
      <Skeleton className="h-20 w-full motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  );

  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
      <Skeleton className="h-7 w-2/3 motion-reduce:animate-none" />
      <div className={ADMIN_REPORT_DETAIL_LAYOUT_CLASS}>
        <div className="flex min-w-0 flex-col gap-4">
          {card}
          {card}
        </div>
        {card}
      </div>
    </div>
  );
}
