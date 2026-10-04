import { isShopEditable } from '@ecommerce/types';

import type { Shop } from './types';

// Form thông tin shop ở /seller/shop có 3 chế độ theo Shop.status (Week8.md 3C.1):
//   - 'readonly': PENDING (đang chờ duyệt) / SUSPENDED (đang bị khoá) — khoá toàn bộ, kèm giải thích;
//   - 'resubmit': REJECTED — sửa xong chỉ có 1 nút chính "Lưu và gửi duyệt lại";
//   - 'edit': APPROVED — sửa như hiện tại ("Lưu thay đổi").
// Luật "trạng thái nào sửa được" lấy từ SHOP_EDITABLE_STATUSES dùng chung (cùng tập BE dùng để chặn PATCH),
// FE không tự suy luật riêng.
export type ShopFormMode = 'readonly' | 'edit' | 'resubmit';

export function getShopFormMode(status: Shop['status']): ShopFormMode {
  if (!isShopEditable(status)) return 'readonly';
  return status === 'REJECTED' ? 'resubmit' : 'edit';
}
