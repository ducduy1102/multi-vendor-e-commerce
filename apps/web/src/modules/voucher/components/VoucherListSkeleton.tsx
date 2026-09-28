import { Skeleton } from '@/shared/components/ui/skeleton';

// Khớp bố cục thật từng dòng trong SellerVouchersContainer (mã + badge + dòng
// mô tả bên trái, nút bật/tắt bên phải) để không nhảy layout khi dữ liệu về —
// cùng tinh thần SellerProductsListSkeleton. aria-hidden vì thuần trang trí,
// thông báo "đang tải" nằm ở vùng bọc ngoài (aria-busy + sr-only).
export function VoucherListSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col divide-y divide-border rounded-lg border border-border"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
              <Skeleton className="h-6 w-16 rounded-4xl motion-reduce:animate-none" />
            </div>
            <Skeleton className="h-3 w-56 max-w-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-7 w-16 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
