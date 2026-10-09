import { getTranslations } from 'next-intl/server';

import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  REVIEW_SECTION_CLASS,
  REVIEW_SKELETON_ITEMS,
  REVIEW_SUMMARY_GRID_CLASS,
} from './ProductReviewList.constants';

// Async Server Component tự đọc getTranslations() cho chuỗi sr-only riêng (đúng pattern ProductDetailSkeleton).
// Khớp bố cục khối thật: tiêu đề, cột điểm + 5 hàng phân bố (cùng lưới REVIEW_SUMMARY_GRID_CLASS), vài dòng
// đánh giá. Phần skeleton chỉ trang trí (`aria-hidden`); vùng bọc `aria-busy` kèm dòng chữ sr-only đã dịch.
export async function ReviewListSkeleton() {
  const t = await getTranslations('review');

  return (
    <section id="reviews" aria-busy="true" className={REVIEW_SECTION_CLASS}>
      <span className="sr-only">{t('loadingSrOnly')}</span>

      <div aria-hidden="true" className="flex flex-col gap-4">
        {/* Tiêu đề (text-lg) */}
        <Skeleton className="h-7 w-48 motion-reduce:animate-none" />

        <div className={REVIEW_SUMMARY_GRID_CLASS}>
          <div className="flex flex-col items-start gap-1">
            <Skeleton className="h-9 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-20 motion-reduce:animate-none" />
          </div>
          <div className="flex flex-col gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full motion-reduce:animate-none" />
            ))}
          </div>
        </div>

        <div className="flex flex-col border-t border-border">
          {Array.from({ length: REVIEW_SKELETON_ITEMS }).map((_, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 border-b border-border py-4">
              <Skeleton className="h-4 w-48 motion-reduce:animate-none" />
              <Skeleton className="h-5 w-full motion-reduce:animate-none" />
              <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
