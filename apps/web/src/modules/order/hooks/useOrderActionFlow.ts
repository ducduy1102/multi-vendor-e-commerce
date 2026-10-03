import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { redirectToPaymentGateway } from '../redirect-to-payment-gateway';
import type { OrderListItem } from '../types';
import { useCancelOrder } from './useCancelOrder';
import { useConfirmReceived } from './useConfirmReceived';
import { useRetryOrderPayment } from './useRetryOrderPayment';

// Chỉ cần 3 field — danh sách (OrderListItem) lẫn trang chi tiết (OrderDetail) đều truyền được.
export type OrderActionTarget = Pick<OrderListItem, 'id' | 'checkoutGroupId' | 'status'>;

type DialogKind = 'cancel' | 'confirmReceived';

// Mọi thứ <OrderActionDialogs> cần để vẽ 2 hộp thoại — trả nguyên cụm để nơi dùng chỉ việc spread.
export interface OrderActionDialogsState {
  // Đơn đang được hỏi xác nhận. Giữ lại cả sau khi đóng (xem isOpen) để nội dung hộp thoại không
  // đổi giữa chừng lúc đang chạy hiệu ứng đóng.
  dialog: { kind: DialogKind; order: OrderActionTarget } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isCancelPending: boolean;
  isConfirmReceivedPending: boolean;
  onCancel: (reason: string | undefined) => void;
  onConfirmReceived: () => void;
}

// Luồng 3 hành động của NGƯỜI MUA trên 1 đơn (hủy, đã nhận hàng, thanh toán lại), dùng chung cho
// trang danh sách và trang chi tiết: trạng thái hộp thoại xác nhận, gọi mutation, dịch lỗi theo
// `code`, khoá nút khi đang chạy. Chỉ chứa luồng — hiển thị nằm ở component thuần.
export function useOrderActionFlow() {
  const t = useTranslations('order');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  const cancelOrder = useCancelOrder();
  const confirmReceived = useConfirmReceived();
  const retryPayment = useRetryOrderPayment();

  const [dialog, setDialog] = useState<OrderActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Sau khi có paymentUrl, trình duyệt đang chuyển sang cổng: giữ nút khoá tới khi rời trang.
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isActionPending =
    cancelOrder.isPending || confirmReceived.isPending || retryPayment.isPending || isRedirecting;

  function describeError(error: unknown): string {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  }

  function openDialog(kind: DialogKind, order: OrderActionTarget) {
    setActionError(null);
    setDialog({ kind, order });
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  async function onCancel(reason: string | undefined) {
    if (!dialog) return;
    try {
      await cancelOrder.mutateAsync({ orderId: dialog.order.id, reason });
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setIsOpen(false);
    }
  }

  async function onConfirmReceived() {
    if (!dialog) return;
    try {
      await confirmReceived.mutateAsync(dialog.order.id);
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
    onCancel: (reason) => void onCancel(reason),
    onConfirmReceived: () => void onConfirmReceived(),
  };

  return {
    actionError,
    isActionPending,
    openCancelDialog: (order: OrderActionTarget) => openDialog('cancel', order),
    openConfirmReceivedDialog: (order: OrderActionTarget) => openDialog('confirmReceived', order),
    retryPayment: startRetryPayment,
    dialogs,
  };
}
