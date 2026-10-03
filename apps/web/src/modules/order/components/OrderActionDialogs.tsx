'use client';

import type { OrderActionDialogsState } from '../hooks/useOrderActionFlow';
import { CancelOrderDialog } from './CancelOrderDialog';
import { ConfirmReceivedDialog } from './ConfirmReceivedDialog';

// Vẽ 2 hộp thoại xác nhận (hủy đơn, đã nhận hàng) từ cụm state của useOrderActionFlow:
// `<OrderActionDialogs {...flow.dialogs} />`. Chỉ 1 trong 2 mở tại 1 thời điểm.
export function OrderActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isCancelPending,
  isConfirmReceivedPending,
  onCancel,
  onConfirmReceived,
}: OrderActionDialogsState) {
  if (!dialog) {
    return null;
  }

  return (
    <>
      <CancelOrderDialog
        open={isOpen && dialog.kind === 'cancel'}
        onOpenChange={onOpenChange}
        // Đơn chưa thanh toán ⇒ BE hủy CẢ NHÓM thanh toán — hộp thoại phải nói rõ điều đó.
        isGroupCancel={dialog.order.status === 'AWAITING_PAYMENT'}
        isPending={isCancelPending}
        onConfirm={onCancel}
      />
      <ConfirmReceivedDialog
        open={isOpen && dialog.kind === 'confirmReceived'}
        onOpenChange={onOpenChange}
        isPending={isConfirmReceivedPending}
        onConfirm={onConfirmReceived}
      />
    </>
  );
}
