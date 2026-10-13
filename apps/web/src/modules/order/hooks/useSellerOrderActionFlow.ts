import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { SellerOrderListItem, SellerRefundRequest, ShipOrderInput } from '../types';
import { useApproveRefundRequest } from './useApproveRefundRequest';
import { useCancelSellerOrder } from './useCancelSellerOrder';
import { useConfirmOrder } from './useConfirmOrder';
import { useDescribeOrderError } from './useDescribeOrderError';
import { usePackOrder } from './usePackOrder';
import { useRejectOrder } from './useRejectOrder';
import { useRejectRefundRequest } from './useRejectRefundRequest';
import { useShipOrder } from './useShipOrder';

// Chỉ cần id — danh sách (SellerOrderListItem) lẫn chi tiết (SellerOrderDetail) đều truyền được.
export type SellerOrderActionTarget = Pick<SellerOrderListItem, 'id'>;

// Yêu cầu hủy/trả hàng cần id (gọi API) và loại (chọn câu trong hộp thoại duyệt: hủy thì hoàn kho, trả hàng
// thì KHÔNG cộng kho).
export type SellerRefundRequestTarget = Pick<SellerRefundRequest, 'id' | 'kind'>;

type OrderDialogKind = 'ship' | 'reject' | 'cancel';
type RefundDialogKind = 'approveRefund' | 'rejectRefund';

// Mọi thứ <SellerOrderActionDialogs> cần để vẽ các hộp thoại — trả nguyên cụm để nơi dùng chỉ spread.
export interface SellerOrderActionDialogsState {
  // Đối tượng đang được hỏi (đơn, hoặc yêu cầu hủy/trả hàng). Giữ lại cả sau khi đóng (xem isOpen) để nội dung
  // không đổi giữa chừng lúc đang chạy hiệu ứng đóng.
  dialog:
    | { kind: OrderDialogKind; order: SellerOrderActionTarget }
    | { kind: RefundDialogKind; request: SellerRefundRequestTarget }
    | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isShipPending: boolean;
  isRejectPending: boolean;
  isCancelPending: boolean;
  isApproveRefundPending: boolean;
  isRejectRefundPending: boolean;
  onShip: (values: ShipOrderInput) => void;
  onReject: (reason: string) => void;
  onCancel: (reason: string) => void;
  onApproveRefund: () => void;
  onRejectRefund: (note: string) => void;
}

// Luồng các hành động của SELLER trên đơn của shop và trên yêu cầu hủy/trả hàng của người mua (xác nhận, đóng
// gói, giao hàng, từ chối, hủy đơn, duyệt/từ chối yêu cầu): trạng thái hộp thoại, gọi mutation, dịch lỗi theo
// `code`, khoá nút khi đang chạy. Xác nhận và đóng gói chạy ngay (hành động bước kế tiếp thường xuyên, không cần
// hỏi lại); giao hàng cần form nhập vận chuyển, các hành động còn lại không hoàn tác nên mở hộp thoại. Gộp một
// luồng duy nhất cho cả đơn lẫn yêu cầu để `isActionPending` khoá chéo: duyệt yêu cầu hủy và tự hủy đơn cùng lúc
// sẽ đụng nhau ở BE. `shopId` do page.tsx truyền xuống (composition root).
export function useSellerOrderActionFlow(shopId: string) {
  const t = useTranslations('order');
  const describeError = useDescribeOrderError();

  const confirmOrder = useConfirmOrder(shopId);
  const packOrder = usePackOrder(shopId);
  const shipOrder = useShipOrder(shopId);
  const rejectOrder = useRejectOrder(shopId);
  const cancelOrder = useCancelSellerOrder(shopId);
  const approveRefund = useApproveRefundRequest(shopId);
  const rejectRefund = useRejectRefundRequest(shopId);

  const [dialog, setDialog] = useState<SellerOrderActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActionPending =
    confirmOrder.isPending ||
    packOrder.isPending ||
    shipOrder.isPending ||
    rejectOrder.isPending ||
    cancelOrder.isPending ||
    approveRefund.isPending ||
    rejectRefund.isPending;

  function openDialog(next: NonNullable<SellerOrderActionDialogsState['dialog']>) {
    setActionError(null);
    setDialog(next);
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsOpen(open);
  }

  // Trả về true khi thành công — để hành động không hoàn tác báo thành công bằng toast (danh sách đổi tại chỗ,
  // yêu cầu vừa xử lý còn biến khỏi tab "Chờ phản hồi" nên cần một lời xác nhận).
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(describeError(error));
      return false;
    }
  }

  async function runDialogAction(action: () => Promise<unknown>, successMessage?: string) {
    const isSuccess = await run(action);
    if (isSuccess && successMessage) toast.success(successMessage);
    setIsOpen(false);
  }

  const dialogs: SellerOrderActionDialogsState = {
    dialog,
    isOpen,
    onOpenChange,
    isShipPending: shipOrder.isPending,
    isRejectPending: rejectOrder.isPending,
    isCancelPending: cancelOrder.isPending,
    isApproveRefundPending: approveRefund.isPending,
    isRejectRefundPending: rejectRefund.isPending,
    onShip: (values) => {
      if (!dialog || !('order' in dialog)) return;
      const { order } = dialog;
      void runDialogAction(() =>
        shipOrder.mutateAsync({
          orderId: order.id,
          carrier: values.carrier,
          trackingCode: values.trackingCode,
        }),
      );
    },
    onReject: (reason) => {
      if (!dialog || !('order' in dialog)) return;
      const { order } = dialog;
      void runDialogAction(() => rejectOrder.mutateAsync({ orderId: order.id, reason }));
    },
    onCancel: (reason) => {
      if (!dialog || !('order' in dialog)) return;
      const { order } = dialog;
      void runDialogAction(
        () => cancelOrder.mutateAsync({ orderId: order.id, reason }),
        t('sellerCancelSuccess'),
      );
    },
    onApproveRefund: () => {
      if (!dialog || !('request' in dialog)) return;
      const { request } = dialog;
      void runDialogAction(
        () => approveRefund.mutateAsync({ requestId: request.id }),
        t('refundApproveSuccess'),
      );
    },
    onRejectRefund: (note) => {
      if (!dialog || !('request' in dialog)) return;
      const { request } = dialog;
      void runDialogAction(
        () => rejectRefund.mutateAsync({ requestId: request.id, note }),
        t('refundRejectSuccess'),
      );
    },
  };

  return {
    actionError,
    isActionPending,
    confirm: (order: SellerOrderActionTarget) => run(() => confirmOrder.mutateAsync(order.id)),
    pack: (order: SellerOrderActionTarget) => run(() => packOrder.mutateAsync(order.id)),
    openShipDialog: (order: SellerOrderActionTarget) => openDialog({ kind: 'ship', order }),
    openRejectDialog: (order: SellerOrderActionTarget) => openDialog({ kind: 'reject', order }),
    openCancelDialog: (order: SellerOrderActionTarget) => openDialog({ kind: 'cancel', order }),
    openApproveRefundDialog: (request: SellerRefundRequestTarget) =>
      openDialog({ kind: 'approveRefund', request }),
    openRejectRefundDialog: (request: SellerRefundRequestTarget) =>
      openDialog({ kind: 'rejectRefund', request }),
    dialogs,
  };
}
