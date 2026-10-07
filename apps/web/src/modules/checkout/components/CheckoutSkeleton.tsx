import { Skeleton } from '@/shared/components/ui/skeleton';

// Khớp bố cục thật của CheckoutContainer (cột địa chỉ + đơn theo shop, cột tóm tắt) — cùng lưới
// với container thật qua hằng CHECKOUT_LAYOUT_CLASS, giống pattern CART_LAYOUT_CLASS
// (modules/cart/components/CartSkeleton.tsx). aria-hidden vì thuần trang trí, "đang tải" nằm ở
// vùng bọc ngoài (aria-busy + sr-only, CheckoutContainer tự thêm). motion-reduce tắt animation.
// `grid-cols-1` và `minmax(0,1fr)` là CHỦ ĐÍCH (không phải `auto`/`1fr` trần): cột `auto`/`1fr` lấy
// min-content của nội dung, nên 1 lời nhắn dài không dấu cách trong ô nhập (field-sizing: content)
// sẽ làm cả trang rộng quá màn hình ở mobile lẫn desktop.
export const CHECKOUT_LAYOUT_CLASS =
  'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start';

// Hàng "lời nhắn cho shop" trong khối mỗi shop — dùng chung giữa khối thật (CheckoutOrderGroup) và
// skeleton để 2 bên không lệch kích thước khi dữ liệu về (rules/frontend.md mục 10).
export const CHECKOUT_SHOP_NOTE_CLASS =
  'flex flex-col gap-1.5 border-t border-border px-3 py-3 sm:px-4';

export function CheckoutSkeleton() {
  return (
    <div aria-hidden="true" className={CHECKOUT_LAYOUT_CLASS}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
          <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
          <Skeleton className="h-16 w-full motion-reduce:animate-none" />
          <Skeleton className="h-16 w-full motion-reduce:animate-none" />
        </div>
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
                  <Skeleton className="h-4 w-48 max-w-full motion-reduce:animate-none" />
                  <Skeleton className="ml-auto h-4 w-16 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
            <div className={CHECKOUT_SHOP_NOTE_CLASS}>
              <Skeleton className="h-4 w-44 motion-reduce:animate-none" />
              <Skeleton className="h-16 w-full motion-reduce:animate-none" />
              <Skeleton className="h-4 w-10 self-end motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
        <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-9 w-full motion-reduce:animate-none" />
      </div>
    </div>
  );
}
