'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

import type { SellerOrderListItem } from '../types';

interface SellerOrderActionsProps {
  // Chỉ 4 cờ do BE tính (mỗi cờ ứng đúng 1 cạnh của bảng chuyển trạng thái) — FE KHÔNG tự suy luật
  // theo status/phương thức thanh toán: "từ chối" chỉ có với đơn COD chưa xác nhận, và khi Tuần 9
  // mở thêm hủy sau xác nhận thì BE bật cờ, không phải sửa FE.
  order: Pick<SellerOrderListItem, 'canConfirm' | 'canPack' | 'canShip' | 'canReject'>;
  // Khoá mọi nút khi 1 hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onConfirm: () => void;
  onPack: () => void;
  onShip: () => void;
  onReject: () => void;
}

// Component THUẦN: hiện nút theo cờ và gọi callback — mutation, hộp thoại, xử lý lỗi nằm ở
// Container. Hành động chính của bước hiện tại dùng primary; "Từ chối" dùng outline (trung tính —
// màu đỏ chỉ ở nút xác nhận trong hộp thoại, accent cam không dùng cho nút huỷ/từ chối).
export function SellerOrderActions({
  order,
  isDisabled,
  onConfirm,
  onPack,
  onShip,
  onReject,
}: SellerOrderActionsProps) {
  const t = useTranslations('order');

  if (!order.canConfirm && !order.canPack && !order.canShip && !order.canReject) {
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
      {order.canReject ? (
        <Button type="button" variant="outline" disabled={isDisabled} onClick={onReject}>
          {t('actionReject')}
        </Button>
      ) : null}
    </div>
  );
}
