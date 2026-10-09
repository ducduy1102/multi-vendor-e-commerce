'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { STAR_COUNT } from '@/shared/components/StarRating';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';
import { cn } from '@/shared/lib/utils';

import {
  buildSellerReviewsHref,
  type SellerReviewRepliedFilter,
  type SellerReviewsPageQuery,
} from '../seller-reviews-query';

interface SellerReviewFiltersProps {
  query: SellerReviewsPageQuery;
}

const RATING_CHIP_CLASS =
  'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

// Hai bộ lọc của danh sách đánh giá, đều là link đổi `?replied=`/`?rating=` trên URL (page.tsx đọc lại qua
// searchParams) — không state cục bộ nên chia sẻ/refresh/nút Back đều giữ đúng bộ lọc. Đổi bộ lọc luôn về trang 1
// và GIỮ bộ lọc còn lại. Tab chưa/đã trả lời giống hàng tab của đơn hàng; số sao là hàng nút bo tròn, tự xuống
// dòng trên màn hẹp. Component THUẦN (chỉ link), không gọi API.
export function SellerReviewFilters({ query }: SellerReviewFiltersProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const stars = Array.from({ length: STAR_COUNT }, (_, index) => STAR_COUNT - index);
  const repliedTabs: readonly { replied: SellerReviewRepliedFilter; label: string }[] = [
    { replied: undefined, label: t('sellerFilterAll') },
    { replied: 'false', label: t('sellerFilterUnreplied') },
    { replied: 'true', label: t('sellerFilterReplied') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label={t('sellerFilterNavLabel')}
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <ul className="flex min-w-max gap-1 border-b border-border">
          {repliedTabs.map(({ replied, label }) => {
            const isActive = replied === query.replied;
            return (
              <li key={label}>
                <Link
                  href={buildSellerReviewsHref({ replied, rating: query.rating })}
                  aria-current={isActive ? 'page' : undefined}
                  className={getTabLinkClass(isActive)}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label={t('filterNavLabel')}>
        <ul className="flex flex-wrap gap-2">
          {[undefined, ...stars].map((rating) => {
            const isActive = rating === query.rating;
            return (
              <li key={rating ?? 'all'}>
                <Link
                  href={buildSellerReviewsHref({ replied: query.replied, rating })}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    RATING_CHIP_CLASS,
                    isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-foreground hover:border-primary hover:text-primary',
                  )}
                >
                  {rating === undefined
                    ? t('sellerRatingAll')
                    : tCommon('starRatingOption', { count: rating })}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
