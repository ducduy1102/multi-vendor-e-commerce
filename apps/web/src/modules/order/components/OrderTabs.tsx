'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import {
  BUYER_ORDER_TAB_KEYS,
  ORDER_TAB_LABEL_KEYS,
  type OrderTabKey,
} from '../order-status-display';
import { BUYER_ORDERS_PATH, buildOrdersHref } from '../orders-href';
import type { OrderTab } from '../types';

interface OrderTabsProps {
  // Không truyền = "Tất cả" (không lọc).
  activeTab?: OrderTab;
  // Mặc định là bộ tab của người mua; Seller truyền SELLER_ORDER_TAB_KEYS (không có "Chờ thanh toán").
  tabs?: readonly OrderTabKey[];
  // Trang chứa các tab (mặc định /orders của người mua; Seller là /seller/orders).
  basePath?: string;
}

// Tab là link thường (đổi `?tab=` trên URL, page.tsx đọc lại qua searchParams) — không state cục
// bộ, nên chia sẻ/refresh/nút Back đều giữ đúng tab. Đổi tab luôn về trang 1. Hàng tab tự cuộn
// ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang).
export function OrderTabs({
  activeTab,
  tabs = BUYER_ORDER_TAB_KEYS,
  basePath = BUYER_ORDERS_PATH,
}: OrderTabsProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const current: OrderTabKey = activeTab ?? 'all';

  return (
    <nav aria-label={t('tabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab) => {
          const isActive = tab === current;
          return (
            <li key={tab}>
              <Link
                href={buildOrdersHref({ tab: tab === 'all' ? undefined : tab, basePath })}
                aria-current={isActive ? 'page' : undefined}
                className={getTabLinkClass(isActive)}
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
