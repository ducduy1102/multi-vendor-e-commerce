import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/shared/lib/utils';

interface ReviewPaginationProps {
  page: number;
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

const linkClassName =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary';

// Phân trang Trước/Sau cho khối đánh giá. Nhận sẵn 2 href đã dựng (kèm neo `#reviews`) từ ProductReviewList —
// không tự đọc/parse query param. Viết riêng ở module review thay vì dùng ProductPagination của module
// product: review bị cấm import product (shared/lib/module-boundaries.test.ts), và hai component dùng khác
// chuỗi dịch (`review.pagination*`).
export function ReviewPagination({ page, totalPages, prevHref, nextHref }: ReviewPaginationProps) {
  const t = useTranslations('review');

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav aria-label={t('paginationLabel')} className="flex items-center justify-center gap-3">
      <Link
        href={prevHref}
        aria-disabled={page <= 1}
        className={cn(linkClassName, page <= 1 && 'pointer-events-none opacity-50')}
      >
        {t('paginationPrev')}
      </Link>
      <span className="text-sm text-muted-foreground">
        {t('paginationStatus', { page, totalPages })}
      </span>
      <Link
        href={nextHref}
        aria-disabled={page >= totalPages}
        className={cn(linkClassName, page >= totalPages && 'pointer-events-none opacity-50')}
      >
        {t('paginationNext')}
      </Link>
    </nav>
  );
}
