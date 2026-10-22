'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import {
  NOTIFICATION_TABS,
  NOTIFICATION_TAB_LABEL_KEYS,
  buildNotificationsHref,
  type NotificationTab,
} from '../notification-page-query';

interface NotificationTabsProps {
  activeTab: NotificationTab;
}

// Tab là link thường (đổi `?tab=` trên URL, page.tsx đọc lại qua searchParams) — không state cục bộ nên chia sẻ/refresh/
// nút Back đều giữ đúng tab. Hàng tab tự cuộn ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang). Cùng
// kiểu với OrderTabs.
export function NotificationTabs({ activeTab }: NotificationTabsProps) {
  const t = useTranslations('notification');

  return (
    <nav aria-label={t('tabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {NOTIFICATION_TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={buildNotificationsHref(tab)}
              aria-current={tab === activeTab ? 'page' : undefined}
              className={getTabLinkClass(tab === activeTab)}
            >
              {t(NOTIFICATION_TAB_LABEL_KEYS[tab])}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
