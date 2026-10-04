'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

import { getAdminShopActions, type AdminShopAction } from '../admin-shop-actions';
import type { ShopStatus } from '../types';

const ACTION_LABEL_KEYS = {
  approve: 'actionApprove',
  reject: 'actionReject',
  suspend: 'actionSuspend',
  unsuspend: 'actionUnsuspend',
} as const satisfies Record<AdminShopAction, string>;

interface AdminShopActionsProps {
  status: ShopStatus;
  // Tên shop — chỉ để gắn vào `aria-label` ("Duyệt: Shop A"): trên 1 trang có nhiều nút "Duyệt"/"Khoá"
  // giống hệt nhau, trình đọc màn hình cần biết nút nào của shop nào.
  shopName: string;
  // Khoá mọi nút khi 1 hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
}

// Component THUẦN: hiện nút theo trạng thái hiện tại của shop (getAdminShopActions — suy từ bảng
// chuyển trạng thái dùng chung với BE) và gọi callback; mutation, hộp thoại, xử lý lỗi nằm ở
// Container. "Duyệt" là hành động chính (primary); "Từ chối"/"Khoá"/"Mở khoá" dùng outline (trung
// tính — màu đỏ chỉ ở nút xác nhận trong hộp thoại, accent cam không dùng cho nút nguy hiểm).
export function AdminShopActions({
  status,
  shopName,
  isDisabled,
  onApprove,
  onReject,
  onSuspend,
  onUnsuspend,
}: AdminShopActionsProps) {
  const t = useTranslations('admin');
  const actions = getAdminShopActions(status);

  if (actions.length === 0) {
    return null;
  }

  const handlers: Record<AdminShopAction, () => void> = {
    approve: onApprove,
    reject: onReject,
    suspend: onSuspend,
    unsuspend: onUnsuspend,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const label = t(ACTION_LABEL_KEYS[action]);
        return (
          <Button
            key={action}
            type="button"
            variant={action === 'approve' ? 'default' : 'outline'}
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', { action: label, name: shopName })}
            onClick={handlers[action]}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
