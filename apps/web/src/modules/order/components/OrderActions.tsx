'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Button } from '@/shared/components/ui/button';

import type { CancelBlockedReasonKey } from '../order-cancel-hint';
import type { OrderListItem } from '../types';

interface OrderActionsProps {
  // Chỉ 3 cờ do BE tính — FE KHÔNG tự suy luật theo status/phương thức thanh toán (đổi chính sách
  // hủy đơn ở Tuần 9 không phải sửa FE).
  order: Pick<OrderListItem, 'canCancel' | 'canConfirmReceived' | 'canRetryPayment'>;
  // Khoá mọi nút khi 1 hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  // Chỉ trang chi tiết truyền: BE không cho hủy (canCancel = false) nhưng đơn ở trạng thái người
  // mua có thể muốn hủy ⇒ hiện nút Hủy BỊ KHOÁ kèm câu giải thích (không ẩn im lặng). Danh sách
  // đơn không truyền — card gọn chỉ hiện hành động làm được.
  cancelBlockedKey?: CancelBlockedReasonKey | null;
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
  cancelBlockedKey = null,
  onCancel,
  onConfirmReceived,
  onRetryPayment,
}: OrderActionsProps) {
  const t = useTranslations('order');
  const hintId = useId();
  // Cờ BE luôn thắng: cho hủy được thì không bao giờ hiện bản bị khoá.
  const blockedKey = order.canCancel ? null : cancelBlockedKey;

  if (!order.canRetryPayment && !order.canConfirmReceived && !order.canCancel && !blockedKey) {
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
      {blockedKey ? (
        <>
          {/* focusableWhenDisabled: vẫn nhận focus bàn phím nên người dùng trình đọc màn hình
              nghe được lý do (aria-describedby) thay vì nút "biến mất" khỏi thứ tự Tab. */}
          <Button
            type="button"
            variant="outline"
            disabled
            focusableWhenDisabled
            aria-describedby={hintId}
          >
            {t('actionCancel')}
          </Button>
          <p id={hintId} className="basis-full text-xs text-muted-foreground">
            {t(blockedKey)}
          </p>
        </>
      ) : null}
    </div>
  );
}
