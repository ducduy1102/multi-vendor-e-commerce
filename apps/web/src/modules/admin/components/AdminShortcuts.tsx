'use client';

import { ChevronRight, HandCoins, Store, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { buildAdminRefundsHref } from '../admin-refunds-href';
import { buildAdminShopsHref } from '../admin-shops-href';

interface Shortcut {
  href: string;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  {
    href: buildAdminShopsHref(),
    icon: Store,
    titleKey: 'navShops',
    descriptionKey: 'overviewShortcutShops',
  },
  {
    href: buildAdminRefundsHref(),
    icon: HandCoins,
    titleKey: 'navRefunds',
    descriptionKey: 'overviewShortcutRefunds',
  },
];

// Lối tắt tới các khu quản trị (phương án A, khối 4). Cố ý nhẹ hơn thẻ việc chờ: không số, không màu. Trang tổng quan
// chỉ hiện khối này khi còn việc hoặc khi chưa có số — không hiện cùng khối "không còn việc nào" (xem AdminOverviewStates).
export function AdminShortcuts() {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="text-sm font-medium text-foreground">
        {t('overviewShortcutsTitle')}
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <li key={shortcut.href}>
              <Link
                href={shortcut.href}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {tDynamic(shortcut.titleKey)}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {tDynamic(shortcut.descriptionKey)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
