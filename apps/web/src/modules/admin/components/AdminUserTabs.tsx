'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';

import { ADMIN_USER_TABS } from '../admin-user-display';
import { buildAdminUsersHref } from '../admin-users-href';
import type { AdminUsersPageQuery } from '../admin-users-page-query';

interface AdminUserTabsProps {
  // Bộ lọc hiện tại: đổi tab giữ nguyên vai và từ khoá (đang tìm "nguyen" thì chuyển tab vẫn là tìm "nguyen"), chỉ đổi trạng
  // thái, về trang 1 và đóng ngăn chi tiết.
  query: Pick<AdminUsersPageQuery, 'status' | 'role' | 'q'>;
}

// Tab là link thường (đổi `?status=` trên URL, page.tsx đọc lại qua searchParams) — không state cục bộ, nên chia sẻ/refresh/
// nút Back đều giữ đúng tab. Chỉ có các trạng thái BE lọc được (không có tab "giả" lọc trên dữ liệu đã phân trang) và không
// hiện số lượng vì BE không có nguồn đáng tin cậy. Hàng tab tự cuộn ngang trong khung của nó trên màn hẹp.
export function AdminUserTabs({ query }: AdminUserTabsProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={t('usersTabsLabel')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {ADMIN_USER_TABS.map((tab) => {
          const isActive = tab.status === query.status;
          return (
            <li key={tab.status ?? 'ALL'}>
              <Link
                href={buildAdminUsersHref({ status: tab.status, role: query.role, q: query.q })}
                aria-current={isActive ? 'page' : undefined}
                className={getTabLinkClass(isActive)}
              >
                {tDynamic(tab.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
