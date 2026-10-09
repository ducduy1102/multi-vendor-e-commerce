import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { getRefundOutcomeToast } from '../admin-refund-display';
import type { AdminRefund, AdminRefundRequest, AdminRefundablePayment } from '../types';
import { useDecideRefundRequest } from './useDecideRefundRequest';
import { useDescribeAdminError } from './useDescribeAdminError';
import { useMarkRefundCompleted } from './useMarkRefundCompleted';
import { useRefundPayment } from './useRefundPayment';
import { useRetryRefund } from './useRetryRefund';

// Chỉ cần id (gọi API) và loại yêu cầu (chọn câu trong hộp thoại duyệt: hủy thì hoàn kho, trả hàng thì KHÔNG
// cộng kho) — dòng của cả 3 bảng đều truyền được.
export type AdminRequestTarget = Pick<AdminRefundRequest, 'id' | 'kind'>;
export type AdminRefundTarget = Pick<AdminRefund, 'id'>;
export type AdminPaymentTarget = Pick<AdminRefundablePayment, 'id'>;

// Mọi thứ <AdminRefundActionDialogs> cần để vẽ các hộp thoại — trả nguyên cụm để nơi dùng chỉ spread.
export interface AdminRefundActionDialogsState {
  // Đối tượng đang được hỏi. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc đang chạy
  // hiệu ứng đóng.
  dialog:
    | { kind: 'approveRequest' | 'rejectRequest'; request: AdminRequestTarget }
    | { kind: 'retryRefund' | 'markCompleted'; refund: AdminRefundTarget }
    | { kind: 'refundPayment'; payment: AdminPaymentTarget }
    | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isDecisionPending: boolean;
  isRetryPending: boolean;
  isMarkCompletedPending: boolean;
  isRefundPaymentPending: boolean;
  // Duyệt: ghi chú tuỳ chọn. Từ chối: ghi chú bắt buộc (đã validate ở form của hộp thoại).
  onApproveRequest: (note: string | undefined) => void;
  onRejectRequest: (note: string) => void;
  onRetryRefund: () => void;
  onMarkCompleted: (reference: string) => void;
  onRefundPayment: (reason: string | undefined) => void;
}

// Luồng các hành động của ADMIN ở khu hoàn tiền: duyệt/từ chối yêu cầu, thử lại / ghi nhận hoàn tay một khoản lỗi,
// hoàn một thanh toán bất thường. Trạng thái hộp thoại, gọi mutation, dịch lỗi theo `code`, khoá nút khi đang
// chạy. Gộp MỘT luồng để `isActionPending` khoá chéo (hai hành động cùng lúc trên cùng khoản tiền là cách nhanh
// nhất để hoàn hai lần). MỌI hành động đều qua hộp thoại xác nhận vì đều chuyển tiền thật hoặc quyết định hộ người
// khác (thử lại cũng vậy: hộp thoại nhắc dùng "Ghi nhận hoàn tay" nếu đã hoàn tay trên trang của cổng, tránh hoàn
// hai lần). Thử lại/hoàn thanh toán/ghi nhận hoàn tay trả 200 kể cả khi cổng vẫn từ chối nên báo theo `status` của
// khoản hoàn (getRefundOutcomeToast), không luôn báo thành công. Mỗi callback chỉ chạy khi ĐÚNG loại hộp thoại
// đang mở (so theo `kind`, không đoán theo hình dạng dữ liệu): các loại có chung hình dạng không bị gọi nhầm.
export function useAdminRefundActionFlow() {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const describeError = useDescribeAdminError();

  const decideRequest = useDecideRefundRequest();
  const retryRefund = useRetryRefund();
  const markCompleted = useMarkRefundCompleted();
  const refundPayment = useRefundPayment();

  const [dialog, setDialog] = useState<AdminRefundActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActionPending =
    decideRequest.isPending ||
    retryRefund.isPending ||
    markCompleted.isPending ||
    refundPayment.isPending;

  function openDialog(next: NonNullable<AdminRefundActionDialogsState['dialog']>) {
    setActionError(null);
    setDialog(next);
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  // Trả về kết quả của hành động, hoặc undefined khi lỗi (đã hiện ở thông báo của trang).
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setActionError(null);
    try {
      return await action();
    } catch (error) {
      setActionError(describeError(error));
      return undefined;
    }
  }

  // Chạy hành động của hộp thoại đang mở: dù thành công hay lỗi hộp thoại đều đóng (lỗi như "Admin khác vừa xử lý"
  // không sửa được bằng cách nhập lại); lỗi hiện ở thông báo của trang.
  async function runDialogAction<T>(
    action: () => Promise<T>,
    successMessage?: string,
  ): Promise<T | undefined> {
    const result = await run(action);
    if (result !== undefined && successMessage) toast.success(successMessage);
    setIsOpen(false);
    return result;
  }

  // Hành động trả về một khoản hoàn: báo theo trạng thái thật của khoản đó thay vì "đã gọi API xong".
  async function runRefundDialogAction(action: () => Promise<AdminRefund>) {
    const result = await runDialogAction(action);
    if (result) {
      const { type, messageKey } = getRefundOutcomeToast(result.status);
      toast[type](tDynamic(messageKey));
    }
  }

  const dialogs: AdminRefundActionDialogsState = {
    dialog,
    isOpen,
    onOpenChange,
    isDecisionPending: decideRequest.isPending,
    isRetryPending: retryRefund.isPending,
    isMarkCompletedPending: markCompleted.isPending,
    isRefundPaymentPending: refundPayment.isPending,
    onApproveRequest: (note) => {
      if (dialog?.kind !== 'approveRequest') return;
      const { request } = dialog;
      void runDialogAction(
        () => decideRequest.mutateAsync({ requestId: request.id, decision: 'APPROVE', note }),
        t('refundsDecisionApproved'),
      );
    },
    onRejectRequest: (note) => {
      if (dialog?.kind !== 'rejectRequest') return;
      const { request } = dialog;
      void runDialogAction(
        () => decideRequest.mutateAsync({ requestId: request.id, decision: 'REJECT', note }),
        t('refundsDecisionRejected'),
      );
    },
    onRetryRefund: () => {
      if (dialog?.kind !== 'retryRefund') return;
      const { refund } = dialog;
      void runRefundDialogAction(() => retryRefund.mutateAsync({ refundId: refund.id }));
    },
    onMarkCompleted: (reference) => {
      if (dialog?.kind !== 'markCompleted') return;
      const { refund } = dialog;
      void runRefundDialogAction(() =>
        markCompleted.mutateAsync({ refundId: refund.id, reference }),
      );
    },
    onRefundPayment: (reason) => {
      if (dialog?.kind !== 'refundPayment') return;
      const { payment } = dialog;
      void runRefundDialogAction(() =>
        refundPayment.mutateAsync({ paymentId: payment.id, reason }),
      );
    },
  };

  return {
    actionError,
    isActionPending,
    openApproveRequestDialog: (request: AdminRequestTarget) =>
      openDialog({ kind: 'approveRequest', request }),
    openRejectRequestDialog: (request: AdminRequestTarget) =>
      openDialog({ kind: 'rejectRequest', request }),
    openRetryDialog: (refund: AdminRefundTarget) => openDialog({ kind: 'retryRefund', refund }),
    openMarkCompletedDialog: (refund: AdminRefundTarget) =>
      openDialog({ kind: 'markCompleted', refund }),
    openRefundPaymentDialog: (payment: AdminPaymentTarget) =>
      openDialog({ kind: 'refundPayment', payment }),
    dialogs,
  };
}
