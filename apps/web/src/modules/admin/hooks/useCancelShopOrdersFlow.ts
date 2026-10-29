import { useState } from 'react';

import { mergeCancelResults, type CancelShopOrdersSummary } from '../admin-cancel-orders-result';
import type { AdminShop } from '../types';
import { useCancelShopOpenOrders } from './useCancelShopOpenOrders';
import { useDescribeAdminError } from './useDescribeAdminError';

// Chỉ cần id + tên (tên hiện trong hộp thoại và là thứ Admin phải gõ lại để xác nhận).
export type CancelShopOrdersTarget = Pick<AdminShop, 'id' | 'name'>;

// Mọi thứ <CancelShopOrdersDialog> cần — trả nguyên cụm để nơi dùng chỉ spread.
export interface CancelShopOrdersDialogState {
  // Shop đang xử lý. Giữ lại cả sau khi đóng (xem isOpen) để nội dung không đổi giữa chừng lúc chạy hiệu ứng đóng.
  target: CancelShopOrdersTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Lỗi của lần gọi gần nhất (đã dịch); null khi chưa có. Hiện NGAY TRONG hộp thoại, cả ở form lẫn ở màn kết quả.
  error: string | null;
  // Kết quả tích luỹ của phiên; null = chưa gọi lần nào (hiện form).
  summary: CancelShopOrdersSummary | null;
  // Lý do đã được form kiểm (bắt buộc, ≤ 500 ký tự) và Admin đã gõ lại đúng tên shop.
  onConfirm: (reason: string) => void;
  // Chạy tiếp lô kế với CÙNG lý do (shop còn đơn chưa giao).
  onContinue: () => void;
}

// Luồng hủy hàng loạt của MỘT shop trong một hộp thoại: form (lý do + gõ lại tên) → gọi API → màn kết quả; còn đơn thì "Hủy tiếp"
// gọi lại với cùng lý do và cộng dồn kết quả. Lỗi cả request (409 shop vừa được mở lại, mất mạng) hiện trong hộp thoại và KHÔNG
// xoá kết quả của các lần trước — việc hủy đã làm được là có thật dù lần gọi sau lỗi.
export function useCancelShopOrdersFlow() {
  const describeError = useDescribeAdminError();
  const cancelOrders = useCancelShopOpenOrders();

  const [target, setTarget] = useState<CancelShopOrdersTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState<CancelShopOrdersSummary | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPending = cancelOrders.isPending;

  function open(shop: CancelShopOrdersTarget) {
    setTarget(shop);
    setSummary(null);
    setReason(null);
    setError(null);
    setIsOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền): đóng giữa chừng làm Admin không thấy kết quả của việc đang chạy.
  function onOpenChange(next: boolean) {
    if (!next && isPending) return;
    setIsOpen(next);
  }

  async function run(nextReason: string) {
    if (!target) return;
    setError(null);
    setReason(nextReason);
    try {
      const result = await cancelOrders.mutateAsync({ shopId: target.id, reason: nextReason });
      setSummary((previous) => mergeCancelResults(previous, result));
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  const dialogState: CancelShopOrdersDialogState = {
    target,
    isOpen,
    onOpenChange,
    isPending,
    error,
    summary,
    onConfirm: (nextReason) => void run(nextReason),
    onContinue: () => {
      if (reason) void run(reason);
    },
  };

  return { open, isPending, dialogState };
}
