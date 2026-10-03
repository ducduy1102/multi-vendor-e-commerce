'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

import type { OrderListItem } from '../types';

interface OrderActionsProps {
  // Chỉ 3 cờ do BE tính — FE KHÔNG tự suy luật theo status/phương thức thanh toán (đổi chính sách
  // hủy đơn ở Tuần 9 không phải sửa FE).
  order: Pick<OrderListItem, 'canCancel' | 'canConfirmReceived' | 'canRetryPayment'>;
  // Khoá mọi nút khi 1 hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onCancel: () => void;
  onConfirmReceived: () => void;
  onRetryPayment: () => void;
}

// Component THUẦN: chỉ hiện nút theo cờ và gọi callback — hộp thoại xác nhận, mutation, xử lý lỗi
// nằm ở Container. "Hủy đơn" dùng outline (trung tính, không đỏ/accent — đỏ chỉ ở nút xác nhận
// trong hộp thoại), hành động chính (thanh toán lại / đã nhận hàng) dùng primary.
export function OrderActions({
  order,
  isDisabled,
  onCancel,
  onConfirmReceived,
  onRetryPayment,
}: OrderActionsProps) {
  const t = useTranslations('order');

  if (!order.canRetryPayment && !order.canConfirmReceived && !order.canCancel) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.canRetryPayment ? (
        <Button type="button" disabled={isDisabled} onClick={onRetryPayment}>
          {t('actionRetryPayment')}
        </Button>
      ) : null}
      {order.canConfirmReceived ? (
        <Button type="button" disabled={isDisabled} onClick={onConfirmReceived}>
          {t('actionConfirmReceived')}
        </Button>
      ) : null}
      {order.canCancel ? (
        <Button type="button" variant="outline" disabled={isDisabled} onClick={onCancel}>
          {t('actionCancel')}
        </Button>
      ) : null}
    </div>
  );
}
