import { useState } from 'react';

import type { AdminShop } from '../types';
import { useDescribeAdminError } from './useDescribeAdminError';
import { useUpdateShopStatus } from './useUpdateShopStatus';

// Chỉ cần id + tên (tên hiện trong hộp thoại để Admin biết đang thao tác trên shop nào).
export type AdminShopActionTarget = Pick<AdminShop, 'id' | 'name'>;

export type AdminShopDialogKind = 'reject' | 'suspend' | 'unsuspend';

// Mọi thứ <AdminShopActionDialogs> cần để vẽ 3 hộp thoại — trả nguyên cụm để nơi dùng chỉ spread.
export interface AdminShopActionDialogsState {
  // Shop đang được hỏi. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc
  // đang chạy hiệu ứng đóng.
  dialog: { kind: AdminShopDialogKind; shop: AdminShopActionTarget } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Từ chối/khoá: lý do bắt buộc (đã validate ở form của hộp thoại).
  onConfirmReason: (reason: string) => void;
  onConfirmUnsuspend: () => void;
}

// Luồng 4 hành động của ADMIN trên 1 shop (duyệt, từ chối, khoá, mở khoá): trạng thái hộp thoại, gọi
// mutation, dịch lỗi theo `code`, khoá nút khi đang chạy. Duyệt chạy ngay (hành động thường xuyên
// nhất của hàng chờ, đảo lại được bằng "Khoá"); từ chối và khoá cần LÝ DO nên mở hộp thoại; mở khoá
// chỉ cần xác nhận nhẹ.
export function useAdminShopActionFlow() {
  const describeError = useDescribeAdminError();
  const updateShopStatus = useUpdateShopStatus();

  const [dialog, setDialog] = useState<AdminShopActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActionPending = updateShopStatus.isPending;

  function openDialog(kind: AdminShopDialogKind, shop: AdminShopActionTarget) {
    setActionError(null);
    setDialog({ kind, shop });
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  async function onConfirmReason(reason: string) {
    if (!dialog || dialog.kind === 'unsuspend') return;
    const status = dialog.kind === 'reject' ? 'REJECTED' : 'SUSPENDED';
    await run(() => updateShopStatus.mutateAsync({ shopId: dialog.shop.id, status, reason }));
    setIsOpen(false);
  }

  async function onConfirmUnsuspend() {
    if (!dialog) return;
    await run(() => updateShopStatus.mutateAsync({ shopId: dialog.shop.id, status: 'APPROVED' }));
    setIsOpen(false);
  }

  const dialogs: AdminShopActionDialogsState = {
    dialog,
    isOpen,
    onOpenChange,
    isPending: isActionPending,
    onConfirmReason: (reason) => void onConfirmReason(reason),
    onConfirmUnsuspend: () => void onConfirmUnsuspend(),
  };

  return {
    actionError,
    isActionPending,
    approve: (shop: AdminShopActionTarget) =>
      run(() => updateShopStatus.mutateAsync({ shopId: shop.id, status: 'APPROVED' })),
    openRejectDialog: (shop: AdminShopActionTarget) => openDialog('reject', shop),
    openSuspendDialog: (shop: AdminShopActionTarget) => openDialog('suspend', shop),
    openUnsuspendDialog: (shop: AdminShopActionTarget) => openDialog('unsuspend', shop),
    dialogs,
  };
}
