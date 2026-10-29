'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import { ADMIN_APPEAL_STATE_DISPLAY, ADMIN_APPEAL_TAB_FILTERS } from '../admin-appeal-display';
import { buildAdminAppealsHref } from '../admin-appeals-href';
import type { AdminAppealListFilter } from '../types';
import { ADMIN_TAB_SCROLL_CLASS } from './admin-tab-fade.constants';

interface AdminAppealTabsProps {
  activeStatus: AdminAppealListFilter;
}

// Tab là link thường (đổi `?status=` trên URL, page.tsx đọc lại qua searchParams) — không state cục bộ, nên chia sẻ/refresh/nút
// Back đều giữ đúng tab. Đổi tab luôn về trang 1. Hàng tab tự cuộn ngang trong khung của nó (có mép mờ) trên màn hẹp. Cùng kiểu
// AdminShopTabs; kiểu một tab nằm ở shared/lib/tab-link-class.
export function AdminAppealTabs({ activeStatus }: AdminAppealTabsProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={t('appealsTabsLabel')} className={ADMIN_TAB_SCROLL_CLASS}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {ADMIN_APPEAL_TAB_FILTERS.map((status) => {
          const isActive = status === activeStatus;
          return (
            <li key={status}>
              <Link
                href={buildAdminAppealsHref({ status })}
                aria-current={isActive ? 'page' : undefined}
                className={getTabLinkClass(isActive)}
              >
                {tDynamic(ADMIN_APPEAL_STATE_DISPLAY[status].tabLabelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
