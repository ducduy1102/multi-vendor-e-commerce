import type { ShopStatus } from '@prisma/client';
import type { ShopStatusEmailKind } from '../../shared/mail/templates/account-email.types';

// Cạnh chuyển trạng thái shop do ADMIN thực hiện ⇒ loại email báo cho chủ shop (Week9.md 1.13). Chỉ liệt kê
// 4 cạnh của Admin trong SHOP_STATUS_TRANSITIONS; cạnh của chủ shop (REJECTED → PENDING, "gửi duyệt lại")
// KHÔNG nằm ở đây nên không gửi mail — người vừa bấm nút không cần email xác nhận, và Admin không có kênh
// email (thông báo trong ứng dụng là Tuần 10).
export function shopStatusEmailKind(
  from: ShopStatus,
  to: ShopStatus,
): ShopStatusEmailKind | null {
  if (from === 'PENDING' && to === 'APPROVED') return 'APPROVED';
  if (from === 'PENDING' && to === 'REJECTED') return 'REJECTED';
  if (from === 'APPROVED' && to === 'SUSPENDED') return 'SUSPENDED';
  if (from === 'SUSPENDED' && to === 'APPROVED') return 'REINSTATED';
  return null;
}

// Trang FE chủ shop nên mở: shop đang bán (duyệt/mở khoá) thì vào quản lý sản phẩm; bị từ chối/khoá thì vào
// trang thông tin shop — nơi hiện trạng thái, lý do và nút "gửi duyệt lại".
export function shopStatusEmailPath(kind: ShopStatusEmailKind): string {
  return kind === 'APPROVED' || kind === 'REINSTATED'
    ? '/seller/products'
    : '/seller/shop';
}

// Lý do chỉ có nghĩa với từ chối/khoá (BE bắt buộc nhập). Duyệt/mở khoá không mang lý do dù body có gửi kèm.
export function shopStatusEmailReason(
  kind: ShopStatusEmailKind,
  reason: string | undefined,
): string | null {
  if (kind !== 'REJECTED' && kind !== 'SUSPENDED') return null;
  return reason?.trim() ? reason.trim() : null;
}
