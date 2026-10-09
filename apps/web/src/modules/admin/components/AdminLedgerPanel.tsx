'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { ADMIN_LEDGER_EMPTY_KEYS } from '../admin-refund-display';
import { useAdminRefundActionFlow } from '../hooks/useAdminRefundActionFlow';
import { useAdminRefunds } from '../hooks/useAdminRefunds';
import type { AdminRefundListFilter } from '../types';
import { AdminRefundActionDialogs } from './AdminRefundActionDialogs';
import { AdminRefundListView } from './AdminRefundListView';
import { AdminRefundRow } from './AdminRefundRow';

interface AdminLedgerPanelProps {
  status: AdminRefundListFilter;
  page: number;
}

// Tab "Hoàn tiền lỗi": sổ cái hoàn tiền (mặc định các khoản cần xử lý — FAILED và PENDING bị bỏ dở). Thử lại và ghi
// nhận hoàn tay đều qua hộp thoại xác nhận; nút theo cờ `canRetry`/`canMarkCompleted` của BE.
export function AdminLedgerPanel({ status, page }: AdminLedgerPanelProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const refundsQuery = useAdminRefunds({ status, page });
  const flow = useAdminRefundActionFlow();

  return (
    <>
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
      <AdminRefundListView
        tab="failed"
        pageQuery={{ tab: 'failed', status, page }}
        data={refundsQuery.data}
        isPending={refundsQuery.isPending}
        onReload={() => void refundsQuery.refetch()}
        emptyMessage={tDynamic(ADMIN_LEDGER_EMPTY_KEYS[status])}
        renderRow={(refund) => (
          <AdminRefundRow
            refund={refund}
            isDisabled={flow.isActionPending}
            onRetry={() => flow.openRetryDialog(refund)}
            onMarkCompleted={() => flow.openMarkCompletedDialog(refund)}
          />
        )}
      />
      <AdminRefundActionDialogs {...flow.dialogs} />
    </>
  );
}
