'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_STATUS_DISPLAY, ADMIN_SHOP_TAB_STATUSES } from '../admin-status-display';
import { buildAdminShopsHref } from '../admin-shops-href';
import type { ShopStatus } from '../types';

interface AdminShopTabsProps {
  activeStatus: ShopStatus;
}

// Tab là link thường (đổi `?status=` trên URL, page.tsx đọc lại qua searchParams) — không state cục
// bộ, nên chia sẻ/refresh/nút Back đều giữ đúng tab. Đổi tab luôn về trang 1. Hàng tab tự cuộn
// ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang). Cùng kiểu OrderTabs nhưng
// module admin không import module order (rules/general.md mục 1).
export function AdminShopTabs({ activeStatus }: AdminShopTabsProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={t('tabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {ADMIN_SHOP_TAB_STATUSES.map((status) => {
          const isActive = status === activeStatus;
          return (
            <li key={status}>
              <Link
                href={buildAdminShopsHref({ status })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex min-h-11 items-center rounded-t-md border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tDynamic(ADMIN_SHOP_STATUS_DISPLAY[status].labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
