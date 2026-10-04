'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/shared/lib/utils';

interface AdminShopPaginationProps {
  page: number;
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

const linkClassName =
  'inline-flex min-h-9 items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:border-primary hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50';

// Component thuần trình bày — cùng bố cục OrderPagination/ProductPagination nhưng module admin không
// import module khác (rules/general.md mục 1). Nhận sẵn 2 href đã build (buildAdminShopsPagination) —
// không tự đọc/parse query param.
export function AdminShopPagination({
  page,
  totalPages,
  prevHref,
  nextHref,
}: AdminShopPaginationProps) {
  const t = useTranslations('admin');

  // Trang vượt quá trang cuối (gõ tay URL) vẫn hiện thanh để người dùng có đường quay về.
  if (totalPages <= 1 && page <= 1) {
    return null;
  }

  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <nav className="flex items-center justify-center gap-3">
      <Link
        href={prevHref}
        aria-disabled={isFirst}
        tabIndex={isFirst ? -1 : undefined}
        className={cn(linkClassName, isFirst && 'pointer-events-none opacity-50')}
      >
        {t('paginationPrev')}
      </Link>
      <span className="text-sm text-muted-foreground">
        {t('paginationStatus', { page, totalPages })}
      </span>
      <Link
        href={nextHref}
        aria-disabled={isLast}
        tabIndex={isLast ? -1 : undefined}
        className={cn(linkClassName, isLast && 'pointer-events-none opacity-50')}
      >
        {t('paginationNext')}
      </Link>
    </nav>
  );
}
