'use client';

import { orderTabSchema } from '@ecommerce/types';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ORDER_TAB_LABEL_KEYS, type OrderTabKey } from '../order-status-display';
import { buildOrdersHref } from '../orders-href';
import type { OrderTab } from '../types';

// "Tất cả" đứng đầu rồi tới 6 tab theo đúng thứ tự enum dùng chung (BE lọc theo cùng enum).
const TAB_KEYS: readonly OrderTabKey[] = ['all', ...orderTabSchema.options];

interface OrderTabsProps {
  // Không truyền = "Tất cả" (không lọc).
  activeTab?: OrderTab;
}

// Tab là link thường (đổi `?tab=` trên URL, page.tsx đọc lại qua searchParams) — không state cục
// bộ, nên chia sẻ/refresh/nút Back đều giữ đúng tab. Đổi tab luôn về trang 1. Hàng tab tự cuộn
// ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang).
export function OrderTabs({ activeTab }: OrderTabsProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const current: OrderTabKey = activeTab ?? 'all';

  return (
    <nav aria-label={t('tabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TAB_KEYS.map((tab) => {
          const isActive = tab === current;
          return (
            <li key={tab}>
              <Link
                href={buildOrdersHref({ tab: tab === 'all' ? undefined : tab })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex min-h-11 items-center rounded-t-md border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tDynamic(ORDER_TAB_LABEL_KEYS[tab])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
