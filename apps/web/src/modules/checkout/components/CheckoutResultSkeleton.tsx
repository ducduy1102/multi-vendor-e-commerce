import { Skeleton } from '@/shared/components/ui/skeleton';

// Khớp bố cục thật của CheckoutResultView (1 alert trạng thái + khối tổng tiền + khối danh sách
// đơn + hàng nút) — cùng tinh thần CheckoutSkeleton/CartSkeleton (rules/frontend.md mục 10).
// aria-hidden vì thuần trang trí, "đang tải" nằm ở vùng bọc ngoài (aria-busy + sr-only,
// CheckoutResultContainer tự thêm). motion-reduce tắt animation.
export function CheckoutResultSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <Skeleton className="h-14 w-full motion-reduce:animate-none" />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
