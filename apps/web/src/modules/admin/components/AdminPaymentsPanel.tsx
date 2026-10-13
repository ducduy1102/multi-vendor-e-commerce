'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';

import { useAdminRefundActionFlow } from '../hooks/useAdminRefundActionFlow';
import { useAdminRefundablePayments } from '../hooks/useAdminRefundablePayments';
import { AdminRefundActionDialogs } from './AdminRefundActionDialogs';
import { AdminRefundListView } from './AdminRefundListView';
import { AdminRefundablePaymentRow } from './AdminRefundablePaymentRow';

interface AdminPaymentsPanelProps {
  page: number;
}

// Tab "Thanh toán cần hoàn": thanh toán thành công bất thường (đến sau khi mọi đơn đã hủy / khách trả hai lần) chưa
// có khoản hoàn nào. Một hành động duy nhất, "Hoàn tiền", qua hộp thoại xác nhận.
export function AdminPaymentsPanel({ page }: AdminPaymentsPanelProps) {
  const t = useTranslations('admin');
  const paymentsQuery = useAdminRefundablePayments({ page });
  const flow = useAdminRefundActionFlow();

  return (
    <>
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
      <AdminRefundListView
        tab="payments"
        pageQuery={{ tab: 'payments', page }}
        data={paymentsQuery.data}
        isPending={paymentsQuery.isPending}
        onReload={() => void paymentsQuery.refetch()}
        emptyMessage={t('refundsEmptyPayments')}
        renderRow={(payment) => (
          <AdminRefundablePaymentRow
            payment={payment}
            isDisabled={flow.isActionPending}
            onRefund={() => flow.openRefundPaymentDialog(payment)}
          />
        )}
      />
      <AdminRefundActionDialogs {...flow.dialogs} />
    </>
  );
}
