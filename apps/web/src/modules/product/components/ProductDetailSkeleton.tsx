import { getTranslations } from 'next-intl/server';

import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  GALLERY_THUMBNAILS_PER_VIEW,
  PRODUCT_DETAIL_LAYOUT_CLASS,
} from './ProductDetail.constants';

// Async Server Component tự đọc getTranslations() cho chuỗi sr-only riêng
// (đúng pattern HomeCatalogSkeleton) — tránh page.tsx phải await
// getTranslations() chỉ để có chuỗi này trước khi trả JSX.
export async function ProductDetailSkeleton() {
  const t = await getTranslations('product');

  return (
    <div aria-busy="true" className={PRODUCT_DETAIL_LAYOUT_CLASS}>
      <span className="sr-only">{t('detailLoadingSrOnly')}</span>

      <div aria-hidden="true" className="flex w-full max-w-md flex-col gap-2">
        <Skeleton className="aspect-square w-full rounded-lg motion-reduce:animate-none" />
        {/* Hàng thumbnail (ProductGallery) chỉ hiện khi sản phẩm có >1 ảnh —
            không biết trước số ảnh thật lúc loading, dùng đúng số thumbnail
            hiện cùng lúc làm ước lượng. */}
        <div className="flex gap-2">
          {Array.from({ length: GALLERY_THUMBNAILS_PER_VIEW }).map((_, index) => (
            <Skeleton
              key={index}
              className="aspect-square min-w-0 flex-[0_0_calc((100%-2rem)/5)] rounded-md motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-3/4 motion-reduce:animate-none" />
          <Skeleton className="h-6 w-32 motion-reduce:animate-none" />
        </div>

        {/* VariantSelector (Bước 3.2) — 1 hàng "nút thuộc tính" ước lượng. */}
        <div className="flex gap-2">
          <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
          <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
          <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
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
