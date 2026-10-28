'use client';

import { StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import {
  getAdminShopActions,
  shouldStackShopActions,
  type AdminShopAction,
} from '../admin-shop-actions';
import type { ShopStatus } from '../types';
import { ADMIN_CAUTION_BUTTON_CLASS } from './admin-caution-button.constants';
import {
  ADMIN_SHOP_ACTION_BUTTON_CLASS,
  ADMIN_SHOP_ACTIONS_INLINE_CLASS,
  ADMIN_SHOP_ACTIONS_STACKED_CLASS,
} from './admin-shop-row.constants';

// Hành động CHÍNH của một trạng thái (đưa shop về APPROVED) dùng nút đặc và luôn đứng trên cùng; mọi hành động còn lại
// (từ chối, khoá, hủy đơn, ghi chú) là nút phụ nằm dưới. "Khoá" là hành động duy nhất của shop đã duyệt nhưng mang tính cẩn
// trọng nên vẫn là nút viền, không phải hành động chính.
const PRIMARY_ACTIONS: ReadonlySet<AdminShopAction> = new Set(['approve', 'unsuspend']);

const CAUTION_ACTIONS: ReadonlySet<AdminShopAction> = new Set(['reject', 'suspend']);

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
  // Hủy hàng loạt đơn chưa giao (Week11.md 4.1): CHỈ hiện ở shop đang bị khoá và khi nơi dùng truyền callback. Không phải cạnh của
  // bảng chuyển trạng thái shop nên không suy từ getAdminShopActions.
  onCancelOrders?: () => void;
  // Mở ngăn ghi chú nội bộ của shop (Week11.md 4.3). Hiện ở MỌI trạng thái (kể cả shop không còn hành động nào — vd đã bị từ chối),
  // vì ghi chú là việc của Admin chứ không phải cạnh của bảng chuyển trạng thái.
  onOpenNotes?: () => void;
}

// Component THUẦN: hiện nút theo trạng thái hiện tại của shop (getAdminShopActions — suy từ bảng
// chuyển trạng thái dùng chung với BE) và gọi callback; mutation, hộp thoại, xử lý lỗi nằm ở
// Container. "Duyệt" và "Mở khoá" là hành động chính (primary, đứng trên cùng); "Từ chối"/"Khoá"/"Hủy đơn chưa giao" là outline
// viền + chữ đỏ (ADMIN_CAUTION_BUTTON_CLASS) và "Ghi chú" là nút ghost. Bố cục cột (xếp dọc khi từ
// 3 nút, một hàng gọn căn phải khi ít hơn) ở admin-shop-row.constants.ts.
export function AdminShopActions({
  status,
  shopName,
  isDisabled,
  onApprove,
  onReject,
  onSuspend,
  onUnsuspend,
  onCancelOrders,
  onOpenNotes,
}: AdminShopActionsProps) {
  const t = useTranslations('admin');
  const actions = getAdminShopActions(status);

  if (actions.length === 0 && !onOpenNotes) {
    return null;
  }

  const handlers: Record<AdminShopAction, () => void> = {
    approve: onApprove,
    reject: onReject,
    suspend: onSuspend,
    unsuspend: onUnsuspend,
  };

  const hasCancelOrders = status === 'SUSPENDED' && Boolean(onCancelOrders);
  const buttonCount = actions.length + (hasCancelOrders ? 1 : 0) + (onOpenNotes ? 1 : 0);

  return (
    <div
      className={
        shouldStackShopActions(buttonCount)
          ? ADMIN_SHOP_ACTIONS_STACKED_CLASS
          : ADMIN_SHOP_ACTIONS_INLINE_CLASS
      }
    >
      {actions.map((action) => {
        const label = t(ACTION_LABEL_KEYS[action]);
        return (
          <Button
            key={action}
            type="button"
            variant={PRIMARY_ACTIONS.has(action) ? 'default' : 'outline'}
            className={cn(
              ADMIN_SHOP_ACTION_BUTTON_CLASS,
              CAUTION_ACTIONS.has(action) && ADMIN_CAUTION_BUTTON_CLASS,
            )}
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', { action: label, name: shopName })}
            onClick={handlers[action]}
          >
            {label}
          </Button>
        );
      })}
      {hasCancelOrders ? (
        <Button
          type="button"
          variant="outline"
          className={cn(ADMIN_SHOP_ACTION_BUTTON_CLASS, ADMIN_CAUTION_BUTTON_CLASS)}
          disabled={isDisabled}
          aria-label={t('actionLabelWithShop', { action: t('actionCancelOrders'), name: shopName })}
          onClick={onCancelOrders}
        >
          {t('actionCancelOrders')}
        </Button>
      ) : null}
      {onOpenNotes ? (
        <Button
          type="button"
          variant="ghost"
          className={ADMIN_SHOP_ACTION_BUTTON_CLASS}
          aria-label={t('actionLabelWithShop', { action: t('actionNotes'), name: shopName })}
          onClick={onOpenNotes}
        >
          <StickyNote aria-hidden="true" data-icon="inline-start" />
          {t('actionNotes')}
        </Button>
      ) : null}
    </div>
  );
}
