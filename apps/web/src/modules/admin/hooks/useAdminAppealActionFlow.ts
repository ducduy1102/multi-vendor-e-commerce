import { useState } from 'react';

import type { AdminAppeal, AppealTargetType } from '../types';
import { useDecideAppeal } from './useDecideAppeal';
import { useDescribeAdminError } from './useDescribeAdminError';

// Chỉ cần những gì hộp thoại hiển thị: id để quyết định, loại đối tượng, tên đối tượng (shop hoặc sản phẩm), lý do đã xử lý (lý do khoá shop
// hoặc lý do gỡ sản phẩm) và lời kháng nghị (Admin đọc ĐỦ trước khi bấm).
export interface AdminAppealActionTarget {
  id: string;
  targetType: AppealTargetType;
  targetName: string;
  moderationReason: string | null;
  message: string;
}

export type AdminAppealDialogKind = 'accept' | 'reject';

// Mọi thứ <AdminAppealDecisionDialog> cần để vẽ — trả nguyên cụm để nơi dùng chỉ spread.
export interface AdminAppealDialogState {
  // Kháng nghị đang được hỏi. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc đang chạy hiệu ứng đóng.
  dialog: { kind: AdminAppealDialogKind; appeal: AdminAppealActionTarget } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Ghi chú đã được form kiểm: chấp nhận thì tuỳ chọn (undefined khi bỏ trống), từ chối thì chắc chắn có.
  onConfirm: (note: string | undefined) => void;
}

export function toAdminAppealActionTarget(appeal: AdminAppeal): AdminAppealActionTarget {
  // Kháng nghị sản phẩm luôn có khối `product` (BE bỏ kháng nghị mà sản phẩm không còn); phòng thủ khi thiếu thì rơi về tên shop.
  const product = appeal.targetType === 'PRODUCT' ? appeal.product : null;
  return {
    id: appeal.id,
    targetType: appeal.targetType,
    targetName: product ? product.name : appeal.shop.name,
    moderationReason: product ? product.takenDownReason : appeal.shop.statusReason,
    message: appeal.message,
  };
}

// Luồng hai hành động của ADMIN trên một kháng nghị (chấp nhận, từ chối): trạng thái hộp thoại, gọi mutation, dịch lỗi theo `code`,
// khoá nút khi đang chạy. CẢ HAI đều mở hộp thoại — quyết định ảnh hưởng chủ shop (mở khoá hoặc giữ khoá không kháng nghị lại được)
// và Admin phải đọc đủ lời kháng nghị trước khi bấm, nên không có nút chạy ngay như "Duyệt" shop.
export function useAdminAppealActionFlow() {
  const describeError = useDescribeAdminError();
  const decideAppeal = useDecideAppeal();

  const [dialog, setDialog] = useState<AdminAppealDialogState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActionPending = decideAppeal.isPending;

  function openDialog(kind: AdminAppealDialogKind, appeal: AdminAppealActionTarget) {
    setActionError(null);
    setDialog({ kind, appeal });
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  async function onConfirm(note: string | undefined) {
    if (!dialog) return;
    setActionError(null);
    try {
      await decideAppeal.mutateAsync({
        appealId: dialog.appeal.id,
        decision: dialog.kind === 'accept' ? 'ACCEPT' : 'REJECT',
        ...(note === undefined ? {} : { note }),
      });
    } catch (error) {
      setActionError(describeError(error));
    }
    setIsOpen(false);
  }

  const dialogs: AdminAppealDialogState = {
    dialog,
    isOpen,
    onOpenChange,
    isPending: isActionPending,
    onConfirm: (note) => void onConfirm(note),
  };

  return {
    actionError,
    isActionPending,
    openAcceptDialog: (appeal: AdminAppealActionTarget) => openDialog('accept', appeal),
    openRejectDialog: (appeal: AdminAppealActionTarget) => openDialog('reject', appeal),
    dialogs,
  };
}
