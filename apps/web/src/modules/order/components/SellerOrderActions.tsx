'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Button } from '@/shared/components/ui/button';

import { getBlockedFulfilmentStep } from '../order-fulfilment-hint';
import type { SellerOrderListItem } from '../types';

interface SellerOrderActionsProps {
  // 5 cờ do BE tính (mỗi cờ ứng đúng 1 cạnh của bảng chuyển trạng thái) — FE KHÔNG tự suy luật theo
  // status/phương thức thanh toán: "từ chối" chỉ có với đơn chưa xác nhận, "hủy đơn" chỉ với đơn đã xác nhận/
  // đóng gói, và khi người mua đang xin hủy BE tắt cờ đóng gói/giao hàng. `status` + `refundRequest` chỉ dùng
  // để chọn lời giải thích cho nút bị khoá (xem getBlockedFulfilmentStep), không bao giờ để bật nút.
  order: Pick<
    SellerOrderListItem,
    'canConfirm' | 'canPack' | 'canShip' | 'canReject' | 'canCancel' | 'status' | 'refundRequest'
  >;
  // Khoá mọi nút khi 1 hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onConfirm: () => void;
  onPack: () => void;
  onShip: () => void;
  onReject: () => void;
  onCancel: () => void;
}

// Component THUẦN: hiện nút theo cờ và gọi callback — mutation, hộp thoại, xử lý lỗi nằm ở Container. Hành động
// chính của bước hiện tại dùng primary; "Từ chối"/"Hủy đơn" dùng outline (trung tính — màu đỏ chỉ ở nút xác
// nhận trong hộp thoại, accent cam không dùng cho nút huỷ/từ chối). Khi người mua đang xin hủy đơn, nút
// "Đóng gói"/"Giao hàng" hiện ở dạng khoá kèm 1 dòng giải thích thay vì biến mất im lặng.
export function SellerOrderActions({
  order,
  isDisabled,
  onConfirm,
  onPack,
  onShip,
  onReject,
  onCancel,
}: SellerOrderActionsProps) {
  const t = useTranslations('order');
  const hintId = useId();
  const blockedStep = getBlockedFulfilmentStep(order);

  if (
    !order.canConfirm &&
    !order.canPack &&
    !order.canShip &&
    !order.canReject &&
    !order.canCancel &&
    !blockedStep
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.canConfirm ? (
        <Button type="button" disabled={isDisabled} onClick={onConfirm}>
          {t('actionConfirmOrder')}
        </Button>
      ) : null}
      {order.canPack ? (
        <Button type="button" disabled={isDisabled} onClick={onPack}>
          {t('actionPack')}
        </Button>
      ) : null}
      {order.canShip ? (
        <Button type="button" disabled={isDisabled} onClick={onShip}>
          {t('actionShip')}
        </Button>
      ) : null}
      {blockedStep ? (
        <Button type="button" disabled aria-describedby={hintId}>
          {blockedStep === 'pack' ? t('actionPack') : t('actionShip')}
        </Button>
      ) : null}
      {order.canReject ? (
        <Button type="button" variant="outline" disabled={isDisabled} onClick={onReject}>
          {t('actionReject')}
        </Button>
      ) : null}
      {order.canCancel ? (
        <Button type="button" variant="outline" disabled={isDisabled} onClick={onCancel}>
          {t('actionCancel')}
        </Button>
      ) : null}
      {blockedStep ? (
        <p id={hintId} className="basis-full text-xs text-muted-foreground">
          {t('fulfilmentBlockedByCancelRequest')}
        </p>
      ) : null}
    </div>
  );
}
