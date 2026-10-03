'use client';

import type { SellerOrderActionDialogsState } from '../hooks/useSellerOrderActionFlow';
import { RejectOrderDialog } from './RejectOrderDialog';
import { ShipOrderDialog } from './ShipOrderDialog';

// Vẽ 2 hộp thoại của Seller (giao hàng, từ chối) từ cụm state của useSellerOrderActionFlow:
// `<SellerOrderActionDialogs {...flow.dialogs} />`. Chỉ 1 trong 2 mở tại 1 thời điểm.
export function SellerOrderActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isShipPending,
  isRejectPending,
  onShip,
  onReject,
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
      <RejectOrderDialog
        open={isOpen && dialog.kind === 'reject'}
        onOpenChange={onOpenChange}
        isPending={isRejectPending}
        onConfirm={onReject}
      />
    </>
  );
}
