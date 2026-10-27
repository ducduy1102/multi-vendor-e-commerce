'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';

import { getAdminUserDetailState } from '../admin-user-detail-state';
import { buildAdminUsersHref, buildAdminUsersPagination } from '../admin-users-href';
import type { AdminUsersPageQuery } from '../admin-users-page-query';
import { useAdminUserActionFlow } from '../hooks/useAdminUserActionFlow';
import { useAdminUserDetail } from '../hooks/useAdminUserDetail';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { ADMIN_USER_TABLE_CLASS } from './admin-user-row.constants';
import { AdminShopPagination } from './AdminShopPagination';
import { AdminUserActions } from './AdminUserActions';
import { AdminUserDetailSheet } from './AdminUserDetailSheet';
import { AdminUserListHeader } from './AdminUserListHeader';
import { AdminUserListSkeleton } from './AdminUserListSkeleton';
import { AdminUserReasonDialog } from './AdminUserReasonDialog';
import { AdminUserRoleFilter } from './AdminUserRoleFilter';
import { AdminUserRow } from './AdminUserRow';
import { AdminUserSearchForm } from './AdminUserSearchForm';
import { AdminUserTabs } from './AdminUserTabs';
import { AdminUsersEmptyState } from './AdminUsersEmptyState';
import { AdminUsersLoadError } from './AdminUsersLoadError';

interface AdminUsersContainerProps {
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseAdminUsersPageQuery).
  query: AdminUsersPageQuery;
}

// Nối dữ liệu (danh sách, chi tiết, luồng hành động) với UI thuần. Đủ loading/error/empty/danh sách (rules/frontend.md mục
// 10). URL là NGUỒN SỰ THẬT duy nhất của bộ lọc, trang và ngăn chi tiết (`?u=`): mở ngăn là điều hướng thêm một mục lịch sử
// (nên Back đóng ngăn, Forward mở lại), đóng ngăn thay mục hiện tại (không để lại mục "ma"). Container không cần unit test
// (mục 8) — phần có logic đã tách ra hàm thuần/hook có test (parseAdminUsersPageQuery, buildAdminUsersHref/Pagination,
// getAdminUserActions, getAdminUserDetailState, useAdminUserActionFlow) và component thuần.
export function AdminUsersContainer({ query }: AdminUsersContainerProps) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const { status, role, q, page, userId } = query;
  const isSheetOpen = userId !== undefined;

  const usersQuery = useAdminUsers({ status, role, q, page });
  const flow = useAdminUserActionFlow();

  // Giữ id cuối cùng đã mở để nội dung ngăn không biến mất giữa chừng lúc chạy hiệu ứng đóng (lúc đó `userId` đã về undefined).
  // "setState có điều kiện trong render" thay cho effect (eslint react-hooks/set-state-in-effect).
  const [shownUserId, setShownUserId] = useState(userId);
  if (userId !== undefined && userId !== shownUserId) {
    setShownUserId(userId);
  }
  const detailQuery = useAdminUserDetail(shownUserId, isSheetOpen);
  const detailState = getAdminUserDetailState(detailQuery);

  function closeSheet(open: boolean) {
    // Hộp thoại xác nhận đang mở phía trên ngăn: Esc/bấm nền thuộc về hộp thoại, không đóng luôn ngăn bên dưới.
    if (open || flow.dialogState.isOpen) return;
    router.replace(buildAdminUsersHref({ status, role, q, page }), { scroll: false });
  }

  function search(nextQuery: string) {
    router.push(buildAdminUsersHref({ status, role, q: nextQuery || undefined }));
  }

  const controls = (
    <>
      <AdminUserTabs query={query} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <AdminUserSearchForm
          key={q ?? ''}
          appliedQuery={q ?? ''}
          onSearch={search}
          clearHref={buildAdminUsersHref({ status, role })}
        />
        <AdminUserRoleFilter query={query} />
      </div>
    </>
  );

  const data = usersQuery.data;
  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách đang xem;
  // chỉ báo lỗi khi chưa có gì để hiện.
  let list;
  if (!data) {
    list = usersQuery.isPending ? (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <AdminUserListSkeleton />
      </div>
    ) : (
      <AdminUsersLoadError onRetry={() => void usersQuery.refetch()} />
    );
  } else if (data.items.length === 0) {
    list = <AdminUsersEmptyState query={query} />;
  } else {
    list = (
      <div className={ADMIN_USER_TABLE_CLASS}>
        <AdminUserListHeader />
        <ul aria-label={t('usersListLabel')} className="divide-y divide-border">
          {data.items.map((user) => (
            <AdminUserRow
              key={user.id}
              user={user}
              detailHref={buildAdminUsersHref({ status, role, q, page, userId: user.id })}
              actions={
                <AdminUserActions
                  user={user}
                  isDisabled={flow.isActionPending}
                  onAction={(action) => flow.openDialog(action, user)}
                />
              }
            />
          ))}
        </ul>
      </div>
    );
  }

  const pagination = data
    ? buildAdminUsersPagination({ status, role, q, page, total: data.total, limit: data.limit })
    : null;

  const detailUser = detailState.status === 'success' ? detailState.user : null;

  return (
    <div className="flex flex-col gap-4">
      {controls}

      {data && data.items.length > 0 ? (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {q
            ? t('usersResultSummaryQuery', { count: data.total, q })
            : t('usersResultSummary', { count: data.total })}
        </p>
      ) : null}

      {list}

      {pagination ? (
        <AdminShopPagination
          page={page}
          totalPages={pagination.totalPages}
          prevHref={pagination.prevHref}
          nextHref={pagination.nextHref}
        />
      ) : null}

      <AdminUserDetailSheet
        open={isSheetOpen}
        onOpenChange={closeSheet}
        state={detailState}
        onRetry={() => void detailQuery.refetch()}
        actions={
          detailUser ? (
            <AdminUserActions
              user={detailUser}
              layout="sheet"
              isDisabled={flow.isActionPending}
              onAction={(action) => flow.openDialog(action, detailUser)}
            />
          ) : null
        }
      />

      {flow.dialogState.dialog ? (
        <AdminUserReasonDialog
          open={flow.dialogState.isOpen}
          onOpenChange={flow.dialogState.onOpenChange}
          action={flow.dialogState.dialog.action}
          user={flow.dialogState.dialog.user}
          isPending={flow.dialogState.isPending}
          error={flow.dialogState.error}
          onConfirm={flow.dialogState.onConfirm}
        />
      ) : null}
    </div>
  );
}
