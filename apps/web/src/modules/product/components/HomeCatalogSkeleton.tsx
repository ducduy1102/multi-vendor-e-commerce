import { getTranslations } from 'next-intl/server';

import { Skeleton } from '@/shared/components/ui/skeleton';
import { HOME_PRODUCTS_LIMIT } from './HomeCatalog.constants';
import { ProductGridSkeleton } from './ProductGridSkeleton';

// Fallback cho <Suspense> bọc HomeCatalog (page.tsx) — khớp bố cục thật
// (section category + lưới sản phẩm, cùng số lượng HOME_PRODUCTS_LIMIT)
// để không nhảy layout khi dữ liệu về. Toàn bộ hình khối là trang trí
// (aria-hidden ở khối riêng) — vùng bọc ngoài mang aria-busy + 1 dòng
// sr-only cho screen reader biết đang tải, không đọc lẫn vào các hình
// khối giả bên trong.
//
// Async Server Component tự gọi getTranslations (giống ProductPagination.tsx)
// thay vì nhận loadingLabel qua prop — trước đó Home() phải await
// getTranslations('product') TRƯỚC khi return JSX chỉ để có chuỗi này, khiến
// <HomeHero /> (không phụ thuộc fetch nào) bị delay theo (vercel-react-best-
// practices, server-parallel-fetching, CRITICAL). Đã xác minh bằng Playwright
// (đọc DOM thật .sr-only, không phải grep HTML thô) rằng dịch vẫn đúng khi
// gọi ở vị trí fallback của Suspense, cả vi lẫn en.
export async function HomeCatalogSkeleton() {
  const t = await getTranslations('product');
  const loadingLabel = t('homeLoadingSrOnly');

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
