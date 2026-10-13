'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import {
  SELLER_REFUND_REQUEST_FILTERS,
  SELLER_REFUND_REQUEST_FILTER_LABEL_KEYS,
  buildSellerRefundRequestsHref,
  type SellerRefundRequestFilter,
} from '../refund-requests-href';

interface SellerRefundRequestTabsProps {
  activeFilter: SellerRefundRequestFilter;
}

// Tab là link thường (đổi `?status=` trên URL, page.tsx đọc lại qua searchParams) — không state cục bộ nên chia
// sẻ/refresh/nút Back đều giữ đúng tab; đổi tab luôn về trang 1. Hàng tab tự cuộn ngang trong khung của nó trên
// màn hẹp (không làm cả trang tràn ngang). Cùng kiểu với OrderTabs.
export function SellerRefundRequestTabs({ activeFilter }: SellerRefundRequestTabsProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav
      aria-label={t('refundQueueTabsLabel')}
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex min-w-max gap-1 border-b border-border">
        {SELLER_REFUND_REQUEST_FILTERS.map((filter) => (
          <li key={filter}>
            <Link
              href={buildSellerRefundRequestsHref({ filter })}
              aria-current={filter === activeFilter ? 'page' : undefined}
              className={getTabLinkClass(filter === activeFilter)}
            >
              {tDynamic(SELLER_REFUND_REQUEST_FILTER_LABEL_KEYS[filter])}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
