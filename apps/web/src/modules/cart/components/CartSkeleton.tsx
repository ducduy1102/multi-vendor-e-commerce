import { Skeleton } from '@/shared/components/ui/skeleton';

// Khớp bố cục thật của CartPageContainer (cột nhóm shop + cột tóm tắt) để
// không nhảy layout khi dữ liệu về — cùng lưới với container thật qua hằng
// CART_LAYOUT_CLASS. aria-hidden vì thuần trang trí, thông báo "đang tải"
// nằm ở vùng bọc ngoài (aria-busy + sr-only). motion-reduce tắt animation.
export const CART_LAYOUT_CLASS = 'grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start';

export function CartSkeleton() {
  return (
    <div aria-hidden="true" className={CART_LAYOUT_CLASS}>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-lg border border-border bg-background"
          >
            <div className="border-b border-border bg-muted/40 px-4 py-2">
              <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 2 }).map((__, row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-16 shrink-0 motion-reduce:animate-none" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-48 max-w-full motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
                  </div>
                  <Skeleton className="h-8 w-24 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-border px-4 py-2">
              <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
              <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
        <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-9 w-full motion-reduce:animate-none" />
      </div>
    </div>
  );
}
