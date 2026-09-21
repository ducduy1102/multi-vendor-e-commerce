import { Skeleton } from '@/shared/components/ui/skeleton';
import { HOME_PRODUCTS_LIMIT } from './HomeCatalog.constants';
import { ProductGridSkeleton } from './ProductGridSkeleton';

interface HomeCatalogSkeletonProps {
  // UI thuần — không tự gọi getTranslations() (Suspense fallback render
  // ngay lập tức, không nên tự await); page.tsx (đã async, đã dịch sẵn cho
  // HomeHero) truyền chữ sr-only đã dịch qua prop.
  loadingLabel: string;
}

// Fallback cho <Suspense> bọc HomeCatalog (page.tsx) — khớp bố cục thật
// (section category + lưới sản phẩm, cùng số lượng HOME_PRODUCTS_LIMIT)
// để không nhảy layout khi dữ liệu về. Toàn bộ hình khối là trang trí
// (aria-hidden ở khối riêng) — vùng bọc ngoài mang aria-busy + 1 dòng
// sr-only cho screen reader biết đang tải, không đọc lẫn vào các hình
// khối giả bên trong.
export function HomeCatalogSkeleton({ loadingLabel }: HomeCatalogSkeletonProps) {
  return (
    <div aria-busy="true" className="flex flex-col gap-10">
      <span className="sr-only">{loadingLabel}</span>

      <div aria-hidden="true" className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-9 w-24 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-9 w-28 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-9 w-20 rounded-full motion-reduce:animate-none" />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
          <ProductGridSkeleton count={HOME_PRODUCTS_LIMIT} />
        </section>
      </div>
    </div>
  );
}
