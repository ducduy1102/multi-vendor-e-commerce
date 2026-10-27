'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_ROLE_FILTERS } from '../admin-user-display';
import { buildAdminUsersHref } from '../admin-users-href';
import type { AdminUsersPageQuery } from '../admin-users-page-query';
import { ADMIN_USER_LINK_FOCUS_CLASS } from './admin-user-row.constants';

interface AdminUserRoleFilterProps {
  // Đổi vai giữ nguyên trạng thái và từ khoá, về trang 1, đóng ngăn chi tiết.
  query: Pick<AdminUsersPageQuery, 'status' | 'role' | 'q'>;
}

// Lọc theo vai (Tất cả / Người dùng / Quản trị viên). BE lọc CHÍNH XÁC bằng SQL nên bộ lọc đúng trên cả dữ liệu đã phân trang
// (không lọc giả trên trang đang xem). Là link thường như tab nên đồng bộ URL và nút Back.
export function AdminUserRoleFilter({ query }: AdminUserRoleFilterProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={t('usersRoleFilterLabel')} className="flex shrink-0 gap-1">
      {ADMIN_USER_ROLE_FILTERS.map((filter) => {
        const isActive = filter.role === query.role;
        return (
          <Link
            key={filter.role ?? 'ALL'}
            href={buildAdminUsersHref({ status: query.status, role: filter.role, q: query.q })}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              ADMIN_USER_LINK_FOCUS_CLASS,
              isActive
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {tDynamic(filter.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
