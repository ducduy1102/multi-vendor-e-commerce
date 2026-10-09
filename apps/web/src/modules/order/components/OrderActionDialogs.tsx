'use client';

import type { OrderActionDialogsState } from '../hooks/useOrderActionFlow';
import { CancelOrderDialog } from './CancelOrderDialog';
import { ConfirmReceivedDialog } from './ConfirmReceivedDialog';
import { RefundRequestConfirmDialog } from './RefundRequestConfirmDialog';
import { RefundRequestDialog } from './RefundRequestDialog';

// Vẽ các hộp thoại xác nhận của người mua (hủy đơn, đã nhận hàng, gửi yêu cầu hủy/trả hàng, rút yêu cầu,
// khiếu nại) từ cụm state của useOrderActionFlow: `<OrderActionDialogs {...flow.dialogs} />`. Chỉ 1 hộp thoại
// mở tại 1 thời điểm.
export function OrderActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isCancelPending,
  isConfirmReceivedPending,
  isRequestRefundPending,
  isWithdrawRefundPending,
  isEscalateRefundPending,
  onCancel,
  onConfirmReceived,
  onRequestRefund,
  onWithdrawRefund,
  onEscalateRefund,
}: OrderActionDialogsState) {
  if (!dialog) {
    return null;
  }

  // Đơn đã thanh toán online (kể cả khi còn chờ shop xác nhận): hủy ngay được hoàn tiền tự động — nói rõ trong
  // hộp thoại. COD không có khoản nào để hoàn qua cổng.
  const isPaidOnline =
    dialog.order.paymentMethod !== 'COD' && dialog.order.paymentStatus === 'SUCCESS';

  return (
    <>
      <CancelOrderDialog
        open={isOpen && dialog.kind === 'cancel'}
        onOpenChange={onOpenChange}
        // Đơn chưa thanh toán ⇒ BE hủy CẢ NHÓM thanh toán — hộp thoại phải nói rõ điều đó.
        isGroupCancel={dialog.order.status === 'AWAITING_PAYMENT'}
        isPaidOnline={isPaidOnline}
        isPending={isCancelPending}
        onConfirm={onCancel}
      />
      <ConfirmReceivedDialog
        open={isOpen && dialog.kind === 'confirmReceived'}
        onOpenChange={onOpenChange}
        isPending={isConfirmReceivedPending}
        onConfirm={onConfirmReceived}
      />
      <RefundRequestDialog
        open={isOpen && dialog.kind === 'requestRefund'}
        onOpenChange={onOpenChange}
        kind={dialog.refundKind ?? 'CANCEL'}
        isPending={isRequestRefundPending}
        onConfirm={onRequestRefund}
      />
      <RefundRequestConfirmDialog
        open={isOpen && dialog.kind === 'withdrawRefund'}
        onOpenChange={onOpenChange}
        variant="withdraw"
        isPending={isWithdrawRefundPending}
        onConfirm={onWithdrawRefund}
      />
      <RefundRequestConfirmDialog
        open={isOpen && dialog.kind === 'escalateRefund'}
        onOpenChange={onOpenChange}
        variant="escalate"
        isPending={isEscalateRefundPending}
        onConfirm={onEscalateRefund}
      />
    </>
  );
}
