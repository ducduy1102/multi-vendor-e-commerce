'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import {
  ADMIN_REFUND_TABS,
  ADMIN_REFUND_TAB_LABEL_KEYS,
  buildAdminRefundsHref,
  type AdminRefundTab,
} from '../admin-refunds-href';

interface AdminRefundTabsProps {
  activeTab: AdminRefundTab;
}

// Tab là link thường (đổi `?tab=` trên URL, page.tsx đọc lại qua searchParams) — không state cục bộ nên chia sẻ/
// refresh/nút Back đều giữ đúng tab; đổi tab luôn về trang 1 và bộ lọc con mặc định của tab đó. Hàng tab tự cuộn
// ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang).
export function AdminRefundTabs({ activeTab }: AdminRefundTabsProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={t('refundsTabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {ADMIN_REFUND_TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={buildAdminRefundsHref({ tab })}
              aria-current={tab === activeTab ? 'page' : undefined}
              className={getTabLinkClass(tab === activeTab)}
            >
              {tDynamic(ADMIN_REFUND_TAB_LABEL_KEYS[tab])}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
