'use client';

import { isShopEditable } from '@ecommerce/types';
import { useTranslations } from 'next-intl';

import type { Shop } from '../types';

// Id cố định để các ô của form gắn `aria-describedby` — trình đọc màn hình đọc lý do khoá khi tới ô đang
// disabled, không chỉ người nhìn thấy dòng chữ.
export const SHOP_EDIT_LOCKED_HINT_ID = 'shop-edit-locked-hint';

// Mỗi trạng thái KHÔNG sửa được phải có câu giải thích riêng (shop-edit-locked-hint test kiểm điều này theo
// SHOP_EDITABLE_STATUSES); trạng thái sửa được thì không có câu nào.
const HINT_KEYS = {
  PENDING: 'shopEditLockedPending',
  SUSPENDED: 'shopEditLockedSuspended',
  REJECTED: null,
  APPROVED: null,
} as const satisfies Record<Shop['status'], string | null>;

interface ShopEditLockedHintProps {
  status: Shop['status'];
}

// Giải thích VÌ SAO form đang khoá (không ẩn im lặng, rules Tuần 8 giống nút hủy đơn bị chặn). Component
// THUẦN trình bày; shop sửa được thì không render gì.
export function ShopEditLockedHint({ status }: ShopEditLockedHintProps) {
  const t = useTranslations('shop');
  const key = HINT_KEYS[status];

  if (isShopEditable(status) || !key) {
    return null;
  }

  return (
    <p id={SHOP_EDIT_LOCKED_HINT_ID} className="text-sm text-muted-foreground">
      {t(key)}
    </p>
  );
}
