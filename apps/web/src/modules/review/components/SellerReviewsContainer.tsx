'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

import { useSellerReviews } from '../hooks/useSellerReviews';
import { buildSellerReviewsPagination, type SellerReviewsPageQuery } from '../seller-reviews-query';
import { ReviewPagination } from './ReviewPagination';
import { SELLER_REVIEWS_CARD_CLASS } from './seller-reviews.constants';
import { SellerReviewFilters } from './SellerReviewFilters';
import { SellerReviewItem } from './SellerReviewItem';
import { SellerReviewsSkeleton } from './SellerReviewsSkeleton';

interface SellerReviewsContainerProps {
  // shopId do page.tsx (composition root) truyền xuống sau khi resolve "shop của tôi" bằng modules/shop — module
  // review không cross-import modules/shop (rules/general.md mục 1).
  shopId: string;
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseSellerReviewsPageQuery).
  query: SellerReviewsPageQuery;
}

// Nối dữ liệu (useSellerReviews) với UI thuần. Đủ loading/error/empty/danh sách (rules/frontend.md mục 10).
// Container không cần unit test (mục 8) — phần có logic đã tách ra hàm thuần/hook/component có test
// (parseSellerReviewsPageQuery, buildSellerReviewsPagination, SellerReviewFilters, SellerReviewItem,
// ReviewReplyForm, useReplyToReview).
export function SellerReviewsContainer({ shopId, query }: SellerReviewsContainerProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');

  const reviewsQuery = useSellerReviews(shopId, {
    replied: query.replied,
    rating: query.rating,
    page: query.page,
  });

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-foreground">{t('sellerPageTitle')}</h1>
      <Link
        href="/seller/products"
        className="shrink-0 text-sm font-medium text-foreground hover:underline"
      >
        {t('sellerBackToProducts')}
      </Link>
    </div>
  );

  // Bộ lọc luôn hiện, dù danh sách đang tải/lỗi/rỗng — người dùng đổi bộ lọc để thoát trạng thái rỗng.
  const filters = <SellerReviewFilters query={query} />;

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách
  // đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const data = reviewsQuery.data;

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {filters}
        {reviewsQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <SellerReviewsSkeleton />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('sellerLoadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void reviewsQuery.refetch()}>
              {t('sellerRetry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildSellerReviewsPagination({ query, total, limit });
  const isFiltered = query.replied !== undefined || query.rating !== undefined;

  return (
    <div className="flex flex-col gap-6">
      {header}
      {filters}

      <p className="text-sm text-muted-foreground">{t('summaryCount', { count: total })}</p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.page > 1
            ? t('pageEmpty')
            : isFiltered
              ? t('sellerEmptyFiltered')
              : t('sellerEmptyState')}
        </p>
      ) : (
        <ul aria-label={t('sellerListLabel')} className={SELLER_REVIEWS_CARD_CLASS}>
          {items.map((review) => (
            <SellerReviewItem key={review.id} review={review} shopId={shopId} />
          ))}
        </ul>
      )}

      <ReviewPagination
        page={query.page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />
    </div>
  );
}
