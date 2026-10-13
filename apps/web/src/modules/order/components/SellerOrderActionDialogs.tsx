'use client';

import type { SellerOrderActionDialogsState } from '../hooks/useSellerOrderActionFlow';
import { RefundRequestConfirmDialog } from './RefundRequestConfirmDialog';
import { SellerReasonDialog } from './SellerReasonDialog';
import { ShipOrderDialog } from './ShipOrderDialog';

// Vẽ các hộp thoại của Seller (giao hàng, từ chối đơn, hủy đơn, duyệt/từ chối yêu cầu của người mua) từ cụm
// state của useSellerOrderActionFlow: `<SellerOrderActionDialogs {...flow.dialogs} />`. Chỉ 1 hộp thoại mở tại
// 1 thời điểm. Hộp thoại duyệt chọn câu theo LOẠI yêu cầu: hủy thì hoàn kho, trả hàng thì nhắc hàng trả về chưa
// được tự cộng vào kho.
export function SellerOrderActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isShipPending,
  isRejectPending,
  isCancelPending,
  isApproveRefundPending,
  isRejectRefundPending,
  onShip,
  onReject,
  onCancel,
  onApproveRefund,
  onRejectRefund,
}: SellerOrderActionDialogsState) {
  if (!dialog) {
    return null;
  }

  return (
    <>
      <ShipOrderDialog
        open={isOpen && dialog.kind === 'ship'}
        onOpenChange={onOpenChange}
        isPending={isShipPending}
        onConfirm={onShip}
      />
      <SellerReasonDialog
        variant="rejectOrder"
        open={isOpen && dialog.kind === 'reject'}
        onOpenChange={onOpenChange}
        isPending={isRejectPending}
        onConfirm={onReject}
      />
      <SellerReasonDialog
        variant="cancelOrder"
        open={isOpen && dialog.kind === 'cancel'}
        onOpenChange={onOpenChange}
        isPending={isCancelPending}
        onConfirm={onCancel}
      />
      <SellerReasonDialog
        variant="rejectRefund"
        open={isOpen && dialog.kind === 'rejectRefund'}
        onOpenChange={onOpenChange}
        isPending={isRejectRefundPending}
        onConfirm={onRejectRefund}
      />
      <RefundRequestConfirmDialog
        open={isOpen && dialog.kind === 'approveRefund'}
        onOpenChange={onOpenChange}
        variant={
          'request' in dialog && dialog.request.kind === 'RETURN'
            ? 'approveReturn'
            : 'approveCancel'
        }
        isPending={isApproveRefundPending}
        onConfirm={onApproveRefund}
      />
    </>
  );
}
