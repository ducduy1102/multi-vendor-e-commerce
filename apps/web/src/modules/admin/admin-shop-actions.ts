import { shopTransitionTargets } from '@ecommerce/types';

import type { AdminShopTargetStatus, ShopStatus } from './types';

export type AdminShopAction = 'approve' | 'reject' | 'suspend' | 'unsuspend';

// Trạng thái ĐÍCH ứng với từng hành động (gửi lên `PATCH /admin/shops/:id/status`).
export const ADMIN_SHOP_ACTION_TARGET: Record<AdminShopAction, AdminShopTargetStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  suspend: 'SUSPENDED',
  unsuspend: 'APPROVED',
};

// Cạnh (từ → đến) của bảng chuyển trạng thái dùng chung -> nút trên giao diện. "Duyệt" và "Mở khoá"
// cùng đích APPROVED nhưng khác điểm xuất phát nên khác nhãn/khác mức xác nhận.
const ACTION_BY_TRANSITION: Partial<Record<string, AdminShopAction>> = {
  'PENDING>APPROVED': 'approve',
  'PENDING>REJECTED': 'reject',
  'APPROVED>SUSPENDED': 'suspend',
  'SUSPENDED>APPROVED': 'unsuspend',
};

// Cột Thao tác của bảng duyệt shop (Week11.md 4.5): từ ngần này nút trở lên thì xếp dọc, mỗi nút rộng đủ cột (11rem không đủ chỗ
// cho 3 nút cạnh nhau — Chờ duyệt, Đã khoá); ít hơn thì giữ MỘT hàng gọn căn phải (Đã duyệt: Khoá + Ghi chú, Đã từ chối: Ghi
// chú) để hàng bảng không cao lên chỉ vì xếp dọc. Dùng chung với skeleton (đếm theo trạng thái) để cột không nhảy khi dữ liệu về.
export const ADMIN_SHOP_ACTIONS_STACK_FROM = 3;

export function shouldStackShopActions(buttonCount: number): boolean {
  return buttonCount >= ADMIN_SHOP_ACTIONS_STACK_FROM;
}

// Hành động Admin làm được với 1 shop đang ở `status` — suy từ các cạnh có actor ADMIN của
// SHOP_STATUS_TRANSITIONS (cùng bảng BE dùng để chặn chuyển sai) nên FE không tự nhớ luật riêng; bảng
// thêm cạnh ADMIN mới mà FE chưa có nút thì admin-shop-actions.test.ts đỏ. Shop đang REJECTED không có
// hành động Admin nào: cạnh duy nhất đi ra (REJECTED → PENDING) thuộc về chủ shop.
export function getAdminShopActions(status: ShopStatus): AdminShopAction[] {
  return shopTransitionTargets('ADMIN', status).flatMap((target) => {
    const action = ACTION_BY_TRANSITION[`${status}>${target}`];
    return action ? [action] : [];
  });
}
