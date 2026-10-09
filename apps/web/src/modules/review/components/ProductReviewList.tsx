import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { buildReviewHref, type ReviewPageQuery } from '../review-page-query';
import * as reviewService from '../services/review.service';
import type { ProductReviewsResponse } from '../types';
import { REVIEW_SECTION_CLASS } from './ProductReviewList.constants';
import { ReviewItem } from './ReviewItem';
import { ReviewPagination } from './ReviewPagination';
import { ReviewSummary } from './ReviewSummary';

interface ProductReviewListProps {
  // Slug của sản phẩm (route /products/[slug]) — dùng cả để gọi API lẫn dựng link lọc/phân trang.
  productSlug: string;
  query: ReviewPageQuery;
}

// Khối đánh giá ở trang chi tiết sản phẩm (đặt SAU mô tả). Server Component async, bọc <Suspense> ở
// ProductDetailContainer (fallback ReviewListSkeleton) nên sản phẩm hiện ngay, đánh giá về sau. Bộ lọc sao và
// trang đọc từ searchParams (`reviewRating`/`reviewPage`, parseReviewPageQuery) ở page.tsx truyền xuống — không
// dùng useSearchParams(), mọi bộ lọc/trang là liên kết thường kèm neo `#reviews`.
//
// Lỗi tải đánh giá chỉ hiện thông báo ngay trong khối này (không ném lên error.tsx): đánh giá là phần phụ, không
// nên làm sập cả trang sản phẩm khi API đánh giá lỗi; không hiện `error.message` (rules/frontend.md mục 10).
export async function ProductReviewList({ productSlug, query }: ProductReviewListProps) {
  const t = await getTranslations('review');

  let data: ProductReviewsResponse;
  try {
    data = await reviewService.listProductReviews(productSlug, {
      rating: query.rating,
      page: query.page,
    });
  } catch {
    return (
      <section id="reviews" aria-labelledby="reviews-heading" className={REVIEW_SECTION_CLASS}>
        <h2 id="reviews-heading" className="text-lg font-semibold text-foreground">
          {t('sectionTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      </section>
    );
  }

  const { summary, items, total, page, limit } = data;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hrefFor = (target: Partial<ReviewPageQuery>) => buildReviewHref(productSlug, target);
  const isFiltered = query.rating !== undefined;

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className={REVIEW_SECTION_CLASS}>
      <h2 id="reviews-heading" className="text-lg font-semibold text-foreground">
        {t('sectionTitle')}
      </h2>

      {summary.reviewCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
      ) : (
        <>
          <ReviewSummary
            summary={summary}
            activeRating={query.rating}
            buildRatingHref={(rating) => hrefFor({ rating })}
          />

          {isFiltered ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {t('filterActive', { count: query.rating ?? 0 })}
              <Link href={hrefFor({})} className="font-medium text-primary hover:underline">
                {t('filterClear')}
              </Link>
            </p>
          ) : null}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isFiltered && total === 0
                ? t('filteredEmptyState', { count: query.rating ?? 0 })
                : t('pageEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col border-t border-border">
              {items.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </ul>
          )}

          <ReviewPagination
            page={page}
            totalPages={totalPages}
            // Kẹp trong [1, totalPages]: URL gõ tay `reviewPage=99` vẫn có đường quay về trang cuối thật.
            prevHref={hrefFor({
              rating: query.rating,
              page: Math.min(Math.max(1, page - 1), totalPages),
            })}
            nextHref={hrefFor({ rating: query.rating, page: Math.min(totalPages, page + 1) })}
          />
        </>
      )}
    </section>
  );
}
