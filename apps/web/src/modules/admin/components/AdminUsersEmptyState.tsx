'use client';

import { SearchX, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_STATUS_DISPLAY, getAdminUsersEmptyKind } from '../admin-user-display';
import { ADMIN_USERS_PATH } from '../admin-users-href';
import type { AdminUsersPageQuery } from '../admin-users-page-query';

interface AdminUsersEmptyStateProps {
  query: Pick<AdminUsersPageQuery, 'status' | 'role' | 'q'>;
}

// Danh sách rỗng, nói ĐÚNG lý do (xem getAdminUsersEmptyKind): tìm/lọc không ra thì kèm gợi ý và nút bỏ bộ lọc; tab trạng
// thái chưa có ai hoặc sàn chưa có người dùng thì chỉ một câu (không có gì để bỏ). Từ khoá hiện trong câu là chuỗi người dùng
// gõ nên chỉ đi vào tham số dịch và render như text.
export function AdminUsersEmptyState({ query }: AdminUsersEmptyStateProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const kind = getAdminUsersEmptyKind(query);
  const isFilterEmpty = kind === 'search' || kind === 'filter';

  const title =
    kind === 'search'
      ? t('usersEmptySearchTitle', { q: query.q ?? '' })
      : kind === 'filter'
        ? t('usersEmptyFilterTitle')
        : kind === 'tab' && query.status
          ? tDynamic(ADMIN_USER_STATUS_DISPLAY[query.status].emptyKey)
          : t('usersEmptyAll');
  const Icon = isFilterEmpty ? SearchX : Users;

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground [overflow-wrap:anywhere]">
          {title}
        </h2>
        {isFilterEmpty ? (
          <p className="text-sm text-muted-foreground">{t('usersEmptyFilterHint')}</p>
        ) : null}
      </div>
      {isFilterEmpty ? (
        <Link href={ADMIN_USERS_PATH} className={cn(buttonVariants({ variant: 'outline' }))}>
          {t('usersClearFilters')}
        </Link>
      ) : null}
    </div>
  );
}
