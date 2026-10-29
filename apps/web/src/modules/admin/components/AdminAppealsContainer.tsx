'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { ADMIN_APPEAL_STATE_DISPLAY } from '../admin-appeal-display';
import { buildAdminAppealsPagination } from '../admin-appeals-href';
import {
  toAdminAppealActionTarget,
  useAdminAppealActionFlow,
} from '../hooks/useAdminAppealActionFlow';
import { useAdminAppeals } from '../hooks/useAdminAppeals';
import type { AdminAppealListFilter } from '../types';
import { ADMIN_APPEAL_TABLE_CLASS } from './admin-appeal-row.constants';
import { AdminAppealActions } from './AdminAppealActions';
import { AdminAppealDecisionDialog } from './AdminAppealDecisionDialog';
import { AdminAppealListHeader } from './AdminAppealListHeader';
import { AdminAppealListSkeleton } from './AdminAppealListSkeleton';
import { AdminAppealRow } from './AdminAppealRow';
import { AdminAppealTabs } from './AdminAppealTabs';
import { AdminShopPagination } from './AdminShopPagination';

interface AdminAppealsContainerProps {
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseAdminAppealsPageQuery).
  status: AdminAppealListFilter;
  page: number;
}

// Nối dữ liệu (useAdminAppeals + luồng quyết định) với UI thuần. Đủ loading/error/empty/danh sách (rules/frontend.md mục 10).
// Container không cần unit test (mục 8) — phần có logic đã tách ra hàm thuần/hook có test (parseAdminAppealsPageQuery,
// buildAdminAppealsPagination, useAdminAppealActionFlow, useDecideAppeal) và component thuần (AdminAppealRow, AdminAppealActions,
// AdminAppealDecisionDialog, tab).
export function AdminAppealsContainer({ status, page }: AdminAppealsContainerProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const tCommon = useTranslations('common');

  const appealsQuery = useAdminAppeals({ status, page });
  const flow = useAdminAppealActionFlow();

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <AdminAppealTabs activeStatus={status} />
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
    </>
  );

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách đang xem; chỉ báo
  // lỗi khi chưa có gì để hiện.
  const data = appealsQuery.data;

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {controls}
        {appealsQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <AdminAppealListSkeleton status={status} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('loadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void appealsQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildAdminAppealsPagination({ status, page, total, limit });
  const { dialog } = flow.dialogs;

  return (
    <div className="flex flex-col gap-6">
      {controls}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tDynamic(ADMIN_APPEAL_STATE_DISPLAY[status].emptyKey)}
        </p>
      ) : (
        <div className={ADMIN_APPEAL_TABLE_CLASS}>
          <AdminAppealListHeader />
          <ul aria-label={t('appealsListLabel')} className="divide-y divide-border">
            {items.map((appeal) => (
              <AdminAppealRow
                key={appeal.id}
                appeal={appeal}
                // Chỉ kháng nghị ĐANG CHỜ quyết định được; dòng đã quyết định / đã đóng không có nút.
                actions={
                  appeal.state === 'PENDING' ? (
                    <AdminAppealActions
                      shopName={appeal.shop.name}
                      isDisabled={flow.isActionPending}
                      onAccept={() => flow.openAcceptDialog(toAdminAppealActionTarget(appeal))}
                      onReject={() => flow.openRejectDialog(toAdminAppealActionTarget(appeal))}
                    />
                  ) : undefined
                }
              />
            ))}
          </ul>
        </div>
      )}

      <AdminShopPagination
        page={page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />

      {dialog ? (
        <AdminAppealDecisionDialog
          open={flow.dialogs.isOpen}
          onOpenChange={flow.dialogs.onOpenChange}
          variant={dialog.kind}
          appeal={dialog.appeal}
          isPending={flow.dialogs.isPending}
          onConfirm={flow.dialogs.onConfirm}
        />
      ) : null}
    </div>
  );
}
