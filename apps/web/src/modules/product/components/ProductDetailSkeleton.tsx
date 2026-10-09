import { getTranslations } from 'next-intl/server';

import { ReviewListSkeleton } from '@/modules/review';
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
    <>
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
          {/* Tiêu đề (text-xl) */}
          <Skeleton className="h-7 w-3/4 motion-reduce:animate-none" />

          {/* Dòng tóm tắt đánh giá (ProductRatingLink, luôn cao 20px) */}
          <Skeleton className="h-5 w-40 motion-reduce:animate-none" />

          {/* Giá (text-lg) + các nhóm thuộc tính (nhãn + hàng nút), khớp
            ProductVariantSection/VariantSelector — ước lượng 2 nhóm. */}
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-16 motion-reduce:animate-none" />
              <div className="flex gap-2">
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-16 motion-reduce:animate-none" />
              <div className="flex gap-2">
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
              </div>
            </div>
          </div>

          {/* Shop + danh mục (dl) */}
          <div className="flex flex-col gap-1">
            <Skeleton className="h-5 w-48 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
          </div>

          {/* Mô tả */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
          </div>
        </div>
      </div>
      {/* Khối đánh giá nằm dưới lưới ở trang thật (ProductDetailContainer) — có sẵn skeleton của nó
        để phần dưới không nhảy xuống khi sản phẩm tải xong. */}
      <ReviewListSkeleton />
    </>
  );
}
