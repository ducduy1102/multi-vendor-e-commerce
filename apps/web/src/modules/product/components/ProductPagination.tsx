import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/shared/lib/utils';

interface ProductPaginationProps {
  page: number;
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

const linkClassName =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900';

// Component thuần trình bày (không gọi API, không giữ state), Server
// Component (không "use client") — dùng getTranslations (async, đúng
// rules/frontend.md mục 2) thay vì hook useTranslations vì component này
// chỉ được compose từ page.tsx (Server), không đi qua Client Component nào.
// Nhận sẵn 2 href đã build từ Server Component cha (page.tsx) — không tự
// đọc/parse query param ở đây.
export async function ProductPagination({
  page,
  totalPages,
  prevHref,
  nextHref,
}: ProductPaginationProps) {
  const t = await getTranslations('product');

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="flex items-center justify-center gap-3">
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
