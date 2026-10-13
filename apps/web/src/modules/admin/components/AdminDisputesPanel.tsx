'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { ADMIN_DISPUTE_EMPTY_KEYS } from '../admin-refund-display';
import type { AdminDisputeFilter } from '../admin-refunds-href';
import { useAdminRefundActionFlow } from '../hooks/useAdminRefundActionFlow';
import { useAdminRefundRequests } from '../hooks/useAdminRefundRequests';
import { AdminRefundActionDialogs } from './AdminRefundActionDialogs';
import { AdminRefundListView } from './AdminRefundListView';
import { AdminRefundRequestRow } from './AdminRefundRequestRow';

interface AdminDisputesPanelProps {
  status: AdminDisputeFilter;
  page: number;
}

// Tab "Khiếu nại": hàng chờ yêu cầu hủy/trả hàng Admin phải quyết (đã lên sàn) hoặc ghi đè khi shop vắng mặt (còn
// chờ shop). Nối dữ liệu + luồng hành động với khung danh sách dùng chung; nút theo cờ `canApprove`/`canReject` của BE.
export function AdminDisputesPanel({ status, page }: AdminDisputesPanelProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const requestsQuery = useAdminRefundRequests({ status, page });
  const flow = useAdminRefundActionFlow();

  return (
    <>
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
      <AdminRefundListView
        tab="disputes"
        pageQuery={{ tab: 'disputes', status, page }}
        data={requestsQuery.data}
        isPending={requestsQuery.isPending}
        onReload={() => void requestsQuery.refetch()}
        emptyMessage={tDynamic(ADMIN_DISPUTE_EMPTY_KEYS[status])}
        renderRow={(request) => (
          <AdminRefundRequestRow
            request={request}
            isDisabled={flow.isActionPending}
            onApprove={() => flow.openApproveRequestDialog(request)}
            onReject={() => flow.openRejectRequestDialog(request)}
          />
        )}
      />
      <AdminRefundActionDialogs {...flow.dialogs} />
    </>
  );
}
