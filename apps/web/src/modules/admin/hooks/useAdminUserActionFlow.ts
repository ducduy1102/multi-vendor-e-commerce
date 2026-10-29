import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { AdminUserAction } from '../admin-user-actions';
import type { AdminUser } from '../types';
import { useChangeUserStatus } from './useChangeUserStatus';
import { useDescribeAdminError } from './useDescribeAdminError';

// Chỉ cần những gì hộp thoại hiển thị (tên + email để Admin biết đang thao tác trên ai, lý do cấm hiện tại khi gỡ cấm) và
// id để gọi API.
export type AdminUserActionTarget = Pick<AdminUser, 'id' | 'name' | 'email' | 'statusReason'>;

export interface AdminUserActionDialogState {
  // Hành động + người đang được hỏi. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc chạy hiệu
  // ứng đóng.
  dialog: { action: AdminUserAction; user: AdminUserActionTarget } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Lỗi của lần xác nhận gần nhất (đã dịch), hiện NGAY TRONG hộp thoại; null khi chưa có.
  error: string | null;
  // Lý do đã được form của hộp thoại kiểm (bắt buộc, ≤ 500 ký tự).
  onConfirm: (reason: string) => void;
}

const TOAST_KEYS = {
  suspend: 'usersToastSuspended',
  ban: 'usersToastBanned',
  reactivate: 'usersToastReactivated',
  unban: 'usersToastUnbanned',
} as const satisfies Record<AdminUserAction, string>;

// Luồng 4 hành động của ADMIN trên 1 tài khoản (tạm khoá, cấm, mở lại, gỡ cấm): trạng thái hộp thoại, gọi mutation, dịch lỗi
// theo `code`, khoá nút khi đang chạy. Khác luồng shop ở hai điểm: MỌI hành động đều cần lý do nên đều mở hộp thoại (không có
// hành động chạy ngay), và khi lỗi (409 có Admin khác vừa xử lý, mất mạng...) hộp thoại GIỮ MỞ kèm thông báo ngay tại đó —
// Admin vừa gõ lý do dài nên không để họ mất nó, và thấy lỗi ở đúng chỗ mắt đang nhìn.
export function useAdminUserActionFlow() {
  const t = useTranslations('admin');
  const describeError = useDescribeAdminError();
  const changeStatus = useChangeUserStatus();

  const [dialog, setDialog] = useState<AdminUserActionDialogState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = changeStatus.isPending;

  function openDialog(action: AdminUserAction, user: AdminUserActionTarget) {
    setError(null);
    setDialog({ action, user });
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu thành công.
  function onOpenChange(open: boolean) {
    if (!open && isPending) return;
    setIsOpen(open);
  }

  async function onConfirm(reason: string) {
    if (!dialog) return;
    setError(null);
    try {
      await changeStatus.mutateAsync({ userId: dialog.user.id, action: dialog.action, reason });
    } catch (caught) {
      setError(describeError(caught));
      return;
    }
    setIsOpen(false);
    toast.success(t(TOAST_KEYS[dialog.action], { name: dialog.user.name }));
  }

  const dialogState: AdminUserActionDialogState = {
    dialog,
    isOpen,
    onOpenChange,
    isPending,
    error,
    onConfirm: (reason) => void onConfirm(reason),
  };

  return {
    isActionPending: isPending,
    openDialog,
    dialogState,
  };
}
