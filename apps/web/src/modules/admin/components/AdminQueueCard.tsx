'use client';

import { ArrowRight, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { AdminQueueDefinition } from '../admin-overview-display';

interface AdminQueueCardProps {
  definition: AdminQueueDefinition;
  // Số việc đang chờ của hàng chờ này (đúng `total` của tab đích).
  count: number;
}

const CARD_CLASS = 'flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4';

// Một thẻ "việc cần xử lý" (phương án A): có việc ⇒ cả thẻ là link tới hàng chờ đã lọc sẵn; 0 việc ⇒ thẻ tĩnh, số mờ,
// không link (không dẫn tới danh sách rỗng). Mobile (< sm) lưới 2×2 gọn: ẩn icon, mô tả và dòng link (thay bằng
// chevron), tiêu đề giữ chỗ 2 dòng để số ở cùng hàng thẳng nhau. Lưới là `grid-cols-2` ở mọi khổ nên thẻ phải
// `min-w-0` để tiêu đề dài không đẩy lưới rộng ra.
export function AdminQueueCard({ definition, count }: AdminQueueCardProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const Icon = definition.icon;
  const hasWork = count > 0;

  const head = (
    <div className="flex items-start gap-2.5 sm:items-center">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground max-sm:hidden">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h2 className="min-w-0 flex-1 text-sm font-medium text-foreground max-sm:line-clamp-2 max-sm:min-h-10 max-sm:text-balance sm:truncate">
        {tDynamic(definition.titleKey)}
      </h2>
      {hasWork ? (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground sm:hidden"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
  const number = (
    <p
      className={cn(
        'text-3xl font-semibold tabular-nums',
        hasWork ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {count}
    </p>
  );
  const caption = (
    <p className="line-clamp-2 text-sm text-pretty text-muted-foreground max-sm:hidden">
      {tDynamic(definition.captionKey)}
    </p>
  );

  if (!hasWork) {
    return (
      <div className={CARD_CLASS}>
        {head}
        {number}
        {caption}
        <span className="mt-auto text-sm text-muted-foreground">{t('overviewQueueClear')}</span>
      </div>
    );
  }

  return (
    <Link
      href={definition.href}
      className={cn(
        CARD_CLASS,
        'group transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      {head}
      {number}
      {caption}
      <span className="mt-auto hidden items-center gap-1 text-sm font-medium text-primary group-hover:underline sm:inline-flex">
        {t('overviewOpenQueue')}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
