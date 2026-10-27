'use client';

import { CircleCheck, RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/shared/components/ui/button';

import { buildAdminRefundsHref } from '../admin-refunds-href';
import { buildAdminShopsHref } from '../admin-shops-href';

// Hai trạng thái của khối "việc cần xử lý" ngoài trạng thái có dữ liệu: không còn việc nào, và không tải được số.

// Không còn việc nào: câu nói rõ + lối đi tiếp (hai khu quản trị). Khi hiện khối này thì KHÔNG hiện khối "Khu quản trị"
// bên dưới (hai nút ở đây đã là lối đi, hiện cả hai là lặp).
export function AdminOverviewEmpty() {
  const t = useTranslations('admin');

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-success">
        <CircleCheck className="size-4" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{t('overviewEmptyTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('overviewEmptyDescription')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={buildAdminShopsHref()} className={buttonVariants({ variant: 'outline' })}>
          {t('overviewEmptyShops')}
        </Link>
        <Link href={buildAdminRefundsHref()} className={buttonVariants({ variant: 'outline' })}>
          {t('overviewEmptyRefunds')}
        </Link>
      </div>
    </div>
  );
}

interface AdminOverviewErrorProps {
  onRetry: () => void;
  isRetrying: boolean;
}

// Không tải được số (và chưa có số nào để hiện). Không hiện `error.message` (rules/frontend.md mục 10); các khu quản trị
// vẫn mở được từ menu nên câu nói rõ điều đó.
export function AdminOverviewError({ onRetry, isRetrying }: AdminOverviewErrorProps) {
  const t = useTranslations('admin');

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{t('overviewErrorTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('overviewErrorDescription')}</p>
        </div>
      </div>
      <Button type="button" variant="outline" disabled={isRetrying} onClick={onRetry}>
        <RotateCw className="size-3.5" aria-hidden="true" />
        {t('overviewRetry')}
      </Button>
    </div>
  );
}
