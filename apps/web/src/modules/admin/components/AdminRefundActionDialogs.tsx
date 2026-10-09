'use client';

import type { AdminRefundActionDialogsState } from '../hooks/useAdminRefundActionFlow';
import { AdminDecisionDialog } from './AdminDecisionDialog';
import { MarkRefundCompletedDialog } from './MarkRefundCompletedDialog';
import { RefundPaymentDialog } from './RefundPaymentDialog';
import { RetryRefundDialog } from './RetryRefundDialog';

// Vẽ các hộp thoại của khu hoàn tiền (duyệt/từ chối yêu cầu, thử lại, ghi nhận hoàn tay, hoàn thanh toán) từ cụm
// state của useAdminRefundActionFlow: `<AdminRefundActionDialogs {...flow.dialogs} />`. Chỉ 1 hộp thoại mở tại 1
// thời điểm.
export function AdminRefundActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isDecisionPending,
  isRetryPending,
  isMarkCompletedPending,
  isRefundPaymentPending,
  onApproveRequest,
  onRejectRequest,
  onRetryRefund,
  onMarkCompleted,
  onRefundPayment,
}: AdminRefundActionDialogsState) {
  if (!dialog) {
    return null;
  }

  const requestKind = 'request' in dialog ? dialog.request.kind : 'CANCEL';

  return (
    <>
      <AdminDecisionDialog
        open={isOpen && dialog.kind === 'approveRequest'}
        onOpenChange={onOpenChange}
        variant="approve"
        kind={requestKind}
        isPending={isDecisionPending}
        onConfirm={onApproveRequest}
      />
      <AdminDecisionDialog
        open={isOpen && dialog.kind === 'rejectRequest'}
        onOpenChange={onOpenChange}
        variant="reject"
        kind={requestKind}
        isPending={isDecisionPending}
        onConfirm={(note) => onRejectRequest(note ?? '')}
      />
      <RetryRefundDialog
        open={isOpen && dialog.kind === 'retryRefund'}
        onOpenChange={onOpenChange}
        isPending={isRetryPending}
        onConfirm={onRetryRefund}
      />
      <MarkRefundCompletedDialog
        open={isOpen && dialog.kind === 'markCompleted'}
        onOpenChange={onOpenChange}
        isPending={isMarkCompletedPending}
        onConfirm={onMarkCompleted}
      />
      <RefundPaymentDialog
        open={isOpen && dialog.kind === 'refundPayment'}
        onOpenChange={onOpenChange}
        isPending={isRefundPaymentPending}
        onConfirm={onRefundPayment}
      />
    </>
  );
}
