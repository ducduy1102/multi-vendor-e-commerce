import { useState } from 'react';

import { redirectToPaymentGateway } from '../redirect-to-payment-gateway';
import type { CreateRefundRequestInput, OrderListItem, RefundRequestKind } from '../types';
import { useCancelOrder } from './useCancelOrder';
import { useConfirmReceived } from './useConfirmReceived';
import { useDescribeOrderError } from './useDescribeOrderError';
import { useEscalateRefundRequest } from './useEscalateRefundRequest';
import { useRequestRefund } from './useRequestRefund';
import { useRetryOrderPayment } from './useRetryOrderPayment';
import { useWithdrawRefundRequest } from './useWithdrawRefundRequest';

// Chỉ cần ít field — danh sách (OrderListItem) lẫn trang chi tiết (OrderDetail) đều truyền được.
// paymentMethod/paymentStatus để hộp thoại hủy biết đơn đã trả online (BE sẽ hoàn tiền) hay chưa.
export type OrderActionTarget = Pick<
  OrderListItem,
  'id' | 'checkoutGroupId' | 'status' | 'paymentMethod' | 'paymentStatus'
>;

type DialogKind =
  'cancel' | 'confirmReceived' | 'requestRefund' | 'withdrawRefund' | 'escalateRefund';

// Mọi thứ <OrderActionDialogs> cần để vẽ các hộp thoại — trả nguyên cụm để nơi dùng chỉ việc spread.
export interface OrderActionDialogsState {
  // Đơn đang được hỏi xác nhận. Giữ lại cả sau khi đóng (xem isOpen) để nội dung hộp thoại không
  // đổi giữa chừng lúc đang chạy hiệu ứng đóng. `refundKind` chỉ có ở hộp thoại gửi yêu cầu (CANCEL =
  // yêu cầu hủy, RETURN = trả hàng/hoàn tiền); `requestId` chỉ có ở hộp thoại rút/khiếu nại.
  dialog: {
    kind: DialogKind;
    order: OrderActionTarget;
    refundKind?: RefundRequestKind;
    requestId?: string;
  } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isCancelPending: boolean;
  isConfirmReceivedPending: boolean;
  isRequestRefundPending: boolean;
  isWithdrawRefundPending: boolean;
  isEscalateRefundPending: boolean;
  onCancel: (reason: string | undefined) => void;
  onConfirmReceived: () => void;
  onRequestRefund: (values: CreateRefundRequestInput) => void;
  onWithdrawRefund: () => void;
  onEscalateRefund: () => void;
}

// Luồng các hành động của NGƯỜI MUA trên 1 đơn (hủy ngay, đã nhận hàng, thanh toán lại, gửi/rút/khiếu nại
// yêu cầu hủy-trả hàng), dùng chung cho trang danh sách và trang chi tiết: trạng thái hộp thoại xác nhận,
// gọi mutation, dịch lỗi theo `code`, khoá nút khi đang chạy. Chỉ chứa luồng — hiển thị nằm ở component thuần.
export function useOrderActionFlow() {
  const describeError = useDescribeOrderError();

  const cancelOrder = useCancelOrder();
  const confirmReceived = useConfirmReceived();
  const retryPayment = useRetryOrderPayment();
  const requestRefund = useRequestRefund();
  const withdrawRefund = useWithdrawRefundRequest();
  const escalateRefund = useEscalateRefundRequest();

  const [dialog, setDialog] = useState<OrderActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Sau khi có paymentUrl, trình duyệt đang chuyển sang cổng: giữ nút khoá tới khi rời trang.
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isActionPending =
    cancelOrder.isPending ||
    confirmReceived.isPending ||
    retryPayment.isPending ||
    requestRefund.isPending ||
    withdrawRefund.isPending ||
    escalateRefund.isPending ||
    isRedirecting;

  function openDialog(next: NonNullable<OrderActionDialogsState['dialog']>) {
    setActionError(null);
    setDialog(next);
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  // Chạy một mutation của hộp thoại đang mở: lỗi thì dịch theo `code` hiện ở thông báo của trang, và dù thành
  // công hay lỗi hộp thoại đều đóng (lỗi như quá hạn/đã đổi trạng thái không sửa được bằng cách nhập lại).
  async function runDialogAction(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setIsOpen(false);
    }
  }

  async function startRetryPayment(order: OrderActionTarget) {
    setActionError(null);
    try {
      // Thanh toán gắn theo NHÓM (1 Payment cho N đơn) nên gọi theo checkoutGroupId của đơn.
      const result = await retryPayment.mutateAsync(order.checkoutGroupId);
      setIsRedirecting(true);
      redirectToPaymentGateway(result.paymentUrl);
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  const dialogs: OrderActionDialogsState = {
    dialog,
    isOpen,
    onOpenChange,
    isCancelPending: cancelOrder.isPending,
    isConfirmReceivedPending: confirmReceived.isPending,
    isRequestRefundPending: requestRefund.isPending,
    isWithdrawRefundPending: withdrawRefund.isPending,
    isEscalateRefundPending: escalateRefund.isPending,
    onCancel: (reason) => {
      if (!dialog) return;
      void runDialogAction(() => cancelOrder.mutateAsync({ orderId: dialog.order.id, reason }));
    },
    onConfirmReceived: () => {
      if (!dialog) return;
      void runDialogAction(() => confirmReceived.mutateAsync(dialog.order.id));
    },
    onRequestRefund: (values) => {
      if (!dialog) return;
      void runDialogAction(() =>
        requestRefund.mutateAsync({ orderId: dialog.order.id, ...values }),
      );
    },
    onWithdrawRefund: () => {
      if (!dialog?.requestId) return;
      const { requestId } = dialog;
      void runDialogAction(() => withdrawRefund.mutateAsync({ requestId }));
    },
    onEscalateRefund: () => {
      if (!dialog?.requestId) return;
      const { requestId } = dialog;
      void runDialogAction(() => escalateRefund.mutateAsync({ requestId }));
    },
  };

  return {
    actionError,
    isActionPending,
    openCancelDialog: (order: OrderActionTarget) => openDialog({ kind: 'cancel', order }),
    openConfirmReceivedDialog: (order: OrderActionTarget) =>
      openDialog({ kind: 'confirmReceived', order }),
    openRequestRefundDialog: (order: OrderActionTarget, refundKind: RefundRequestKind) =>
      openDialog({ kind: 'requestRefund', order, refundKind }),
    openWithdrawRefundDialog: (order: OrderActionTarget, requestId: string) =>
      openDialog({ kind: 'withdrawRefund', order, requestId }),
    openEscalateRefundDialog: (order: OrderActionTarget, requestId: string) =>
      openDialog({ kind: 'escalateRefund', order, requestId }),
    retryPayment: startRetryPayment,
    dialogs,
  };
}
