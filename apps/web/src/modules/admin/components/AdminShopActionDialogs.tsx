'use client';

import type { AdminShopActionDialogsState } from '../hooks/useAdminShopActionFlow';
import { ShopReasonDialog } from './ShopReasonDialog';
import { UnsuspendShopDialog } from './UnsuspendShopDialog';

// Vẽ 3 hộp thoại của Admin (từ chối, khoá, mở khoá) từ cụm state của useAdminShopActionFlow:
// `<AdminShopActionDialogs {...flow.dialogs} />`. Chỉ 1 trong 3 mở tại 1 thời điểm.
export function AdminShopActionDialogs({
  dialog,
  isOpen,
  onOpenChange,
  isPending,
  onConfirmReason,
  onConfirmUnsuspend,
}: AdminShopActionDialogsState) {
  if (!dialog) {
    return null;
  }

  return (
    <>
      <ShopReasonDialog
        open={isOpen && dialog.kind === 'reject'}
        onOpenChange={onOpenChange}
        kind="reject"
        shopName={dialog.shop.name}
        isPending={isPending}
        onConfirm={onConfirmReason}
      />
      <ShopReasonDialog
        open={isOpen && dialog.kind === 'suspend'}
        onOpenChange={onOpenChange}
        kind="suspend"
        shopName={dialog.shop.name}
        isPending={isPending}
        onConfirm={onConfirmReason}
      />
      <UnsuspendShopDialog
        open={isOpen && dialog.kind === 'unsuspend'}
        onOpenChange={onOpenChange}
        shopName={dialog.shop.name}
        isPending={isPending}
        onConfirm={onConfirmUnsuspend}
      />
    </>
  );
}
