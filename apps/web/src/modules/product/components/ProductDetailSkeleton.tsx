import { getTranslations } from 'next-intl/server';

import { Skeleton } from '@/shared/components/ui/skeleton';
import { PRODUCT_DETAIL_LAYOUT_CLASS } from './ProductDetail.constants';

// Async Server Component tự đọc getTranslations() cho chuỗi sr-only riêng
// (đúng pattern HomeCatalogSkeleton) — tránh page.tsx phải await
// getTranslations() chỉ để có chuỗi này trước khi trả JSX.
export async function ProductDetailSkeleton() {
  const t = await getTranslations('product');

  return (
    <div aria-busy="true" className={PRODUCT_DETAIL_LAYOUT_CLASS}>
      <span className="sr-only">{t('detailLoadingSrOnly')}</span>

      <Skeleton
        aria-hidden="true"
        className="aspect-square w-full rounded-lg motion-reduce:animate-none"
      />

      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-3/4 motion-reduce:animate-none" />
          <Skeleton className="h-6 w-32 motion-reduce:animate-none" />
        </div>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
        </div>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
