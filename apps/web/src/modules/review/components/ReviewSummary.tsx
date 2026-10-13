import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { STAR_COUNT, StarRating } from '@/shared/components/StarRating';
import { cn } from '@/shared/lib/utils';
import type { ReviewSummary as ReviewSummaryData } from '../types';
import { REVIEW_SUMMARY_GRID_CLASS } from './ProductReviewList.constants';

interface ReviewSummaryProps {
  summary: ReviewSummaryData;
  // Số sao đang lọc (undefined = tất cả) — hàng tương ứng được tô sáng.
  activeRating: number | undefined;
  // Đường dẫn khi bấm một hàng: truyền số sao để lọc, `undefined` để bỏ lọc. Do nơi gọi dựng (biết slug sản
  // phẩm và các param khác của trang) — component không tự biết URL.
  buildRatingHref: (rating: number | undefined) => string;
}

// Tóm tắt đánh giá: điểm trung bình + số đánh giá + 5 hàng phân bố sao. Mỗi hàng là một liên kết lọc danh sách
// (bấm lại hàng đang lọc thì bỏ lọc), thay cho một dải nút lọc riêng — cùng một nơi vừa xem phân bố vừa lọc,
// như các sàn thật. Thanh chỉ là trang trí (`aria-hidden`), số đếm đã nằm trong chữ của hàng. Server Component
// được (chỉ dùng hook của next-intl), dữ liệu do ProductReviewList truyền xuống.
export function ReviewSummary({ summary, activeRating, buildRatingHref }: ReviewSummaryProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const average = format.number(summary.avgRating, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return (
    <div className={REVIEW_SUMMARY_GRID_CLASS}>
      <div className="flex flex-col items-start gap-1">
        <p className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold text-foreground">{average}</span>
          <span className="text-sm text-muted-foreground">/ {STAR_COUNT}</span>
        </p>
        <StarRating value={summary.avgRating} size="md" />
        <p className="text-sm text-muted-foreground">
          {t('summaryCount', { count: summary.reviewCount })}
        </p>
      </div>

      <nav aria-label={t('filterNavLabel')}>
        <ul className="flex flex-col gap-1">
          {Array.from({ length: STAR_COUNT }, (_, index) => STAR_COUNT - index).map((star) => {
            const count = summary.distribution[String(star) as keyof typeof summary.distribution];
            const isActive = activeRating === star;
            const percent = summary.reviewCount > 0 ? (count / summary.reviewCount) * 100 : 0;
            return (
              <li key={star}>
                <Link
                  href={buildRatingHref(isActive ? undefined : star)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'grid min-h-8 grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    isActive ? 'bg-primary/10 font-medium text-primary' : 'text-foreground',
                  )}
                >
                  <span>{tCommon('starRatingOption', { count: star })}</span>
                  <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
