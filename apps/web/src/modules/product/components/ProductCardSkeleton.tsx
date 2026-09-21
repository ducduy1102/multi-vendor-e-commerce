import { Skeleton } from '@/shared/components/ui/skeleton';

// UI thuần, không props — khớp tỷ lệ ảnh (aspect-square) và bố cục
// (ảnh + 2 dòng tên + 1 dòng giá) với ProductPreviewCard thật, để không
// nhảy layout khi dữ liệu về. aria-hidden vì đây thuần trang trí — thông
// báo "đang tải" thật nằm ở vùng bọc ngoài (HomeCatalogSkeleton, sr-only).
// motion-reduce:animate-none tôn trọng prefers-reduced-motion.
export function ProductCardSkeleton() {
  return (
    <div
      data-slot="product-card-skeleton"
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-background"
    >
      <Skeleton className="aspect-square w-full rounded-none motion-reduce:animate-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
