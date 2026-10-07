import { useState } from 'react';

import type { SellerOrderListItem, ShipOrderInput } from '../types';
import { useConfirmOrder } from './useConfirmOrder';
import { useDescribeOrderError } from './useDescribeOrderError';
import { usePackOrder } from './usePackOrder';
import { useRejectOrder } from './useRejectOrder';
import { useShipOrder } from './useShipOrder';

// Chỉ cần id — danh sách (SellerOrderListItem) lẫn chi tiết (SellerOrderDetail) đều truyền được.
export type SellerOrderActionTarget = Pick<SellerOrderListItem, 'id'>;

type DialogKind = 'ship' | 'reject';

// Mọi thứ <SellerOrderActionDialogs> cần để vẽ 2 hộp thoại — trả nguyên cụm để nơi dùng chỉ spread.
export interface SellerOrderActionDialogsState {
  // Đơn đang được hỏi. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc
  // đang chạy hiệu ứng đóng.
  dialog: { kind: DialogKind; order: SellerOrderActionTarget } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isShipPending: boolean;
  isRejectPending: boolean;
  onShip: (values: ShipOrderInput) => void;
  onReject: (reason: string) => void;
}

// Luồng 4 hành động của SELLER trên 1 đơn của shop (xác nhận, đóng gói, giao hàng, từ chối): trạng
// thái hộp thoại, gọi mutation, dịch lỗi theo `code`, khoá nút khi đang chạy. Xác nhận và đóng gói
// chạy ngay (hành động bước kế tiếp thường xuyên, không cần hỏi lại); giao hàng cần form nhập vận
// chuyển, từ chối cần lý do nên mở hộp thoại. `shopId` do page.tsx truyền xuống (composition root).
export function useSellerOrderActionFlow(shopId: string) {
  const describeError = useDescribeOrderError();

  const confirmOrder = useConfirmOrder(shopId);
  const packOrder = usePackOrder(shopId);
  const shipOrder = useShipOrder(shopId);
  const rejectOrder = useRejectOrder(shopId);

  const [dialog, setDialog] = useState<SellerOrderActionDialogsState['dialog']>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActionPending =
    confirmOrder.isPending || packOrder.isPending || shipOrder.isPending || rejectOrder.isPending;

  function openDialog(kind: DialogKind, order: SellerOrderActionTarget) {
    setActionError(null);
    setDialog({ kind, order });
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

  async function onShip(values: ShipOrderInput) {
    if (!dialog) return;
    await run(() =>
      shipOrder.mutateAsync({
        orderId: dialog.order.id,
        carrier: values.carrier,
        trackingCode: values.trackingCode,
      }),
    );
    setIsOpen(false);
  }

  async function onReject(reason: string) {
    if (!dialog) return;
    await run(() => rejectOrder.mutateAsync({ orderId: dialog.order.id, reason }));
    setIsOpen(false);
  }

  const dialogs: SellerOrderActionDialogsState = {
    dialog,
    isOpen,
    onOpenChange,
    isShipPending: shipOrder.isPending,
    isRejectPending: rejectOrder.isPending,
    onShip: (values) => void onShip(values),
    onReject: (reason) => void onReject(reason),
  };

  return {
    actionError,
    isActionPending,
    confirm: (order: SellerOrderActionTarget) => run(() => confirmOrder.mutateAsync(order.id)),
    pack: (order: SellerOrderActionTarget) => run(() => packOrder.mutateAsync(order.id)),
    openShipDialog: (order: SellerOrderActionTarget) => openDialog('ship', order),
    openRejectDialog: (order: SellerOrderActionTarget) => openDialog('reject', order),
    dialogs,
  };
}
