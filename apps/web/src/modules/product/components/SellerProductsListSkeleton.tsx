import { Skeleton } from '@/shared/components/ui/skeleton';

// Khớp bố cục thật của từng dòng trong SellerProductsContainer (tên + giá
// bên trái, badge trạng thái + 2 action bên phải) để không nhảy layout khi
// dữ liệu về — cùng tinh thần ProductCardSkeleton/ShopFormFieldsSkeleton.
// aria-hidden vì thuần trang trí, thông báo "đang tải" thật nằm ở vùng bọc
// ngoài (page.tsx / SellerProductsContainer, sr-only). 3 dòng mẫu, không
// cần khớp đúng số lượng sản phẩm thật.
export function SellerProductsListSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col divide-y divide-border rounded-lg border border-border"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-20 motion-reduce:animate-none" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="h-7 w-16 rounded-[min(var(--radius-md),12px)] motion-reduce:animate-none" />
            <Skeleton className="h-7 w-12 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-16 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
