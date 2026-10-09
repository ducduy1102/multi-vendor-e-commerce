import type {
  AdminRefundListQuery,
  AdminRefundRequestListQuery,
  AdminRefundablePaymentListQuery,
  AdminShopListQuery,
} from '../types';

// Mọi query key của module admin khai ở ĐÂY (1 chỗ duy nhất, như order-query-keys) — hook đọc và hook
// mutation dùng chung, tránh gõ tay 2 nơi rồi lệch nhau.

// --- Shop ----------------------------------------------------------------------------------------

// Tiền tố của MỌI danh sách shop (mọi tab/trang) — dùng để invalidate: 1 shop đổi trạng thái là rời
// tab này sang tab khác nên mọi tab đều cũ.
export function adminShopListsQueryKey() {
  return ['admin', 'shops', 'list'] as const;
}

export function adminShopListQueryKey(query: Partial<AdminShopListQuery>) {
  return [...adminShopListsQueryKey(), query] as const;
}

// --- Hoàn tiền (Week9.md 3.1) --------------------------------------------------------------------
// Ba màn tách ba nhánh riêng để làm mới màn này không kéo theo màn kia khi không cần; hook mutation tự
// chọn nhánh nào đổi (duyệt yêu cầu tạo khoản hoàn mới ⇒ cả hàng chờ lẫn sổ cái cũ).

// Hàng chờ yêu cầu hủy/trả hàng (tab "Khiếu nại").
export function adminRefundRequestListsQueryKey() {
  return ['admin', 'refund-requests', 'list'] as const;
}

export function adminRefundRequestListQueryKey(query: Partial<AdminRefundRequestListQuery>) {
  return [...adminRefundRequestListsQueryKey(), query] as const;
}

// Sổ cái hoàn tiền (tab "Hoàn tiền lỗi" và lịch sử).
export function adminRefundListsQueryKey() {
  return ['admin', 'refunds', 'list'] as const;
}

export function adminRefundListQueryKey(query: Partial<AdminRefundListQuery>) {
  return [...adminRefundListsQueryKey(), query] as const;
}

// Thanh toán bất thường (tab "Thanh toán cần hoàn").
export function adminRefundablePaymentListsQueryKey() {
  return ['admin', 'refundable-payments', 'list'] as const;
}

export function adminRefundablePaymentListQueryKey(
  query: Partial<AdminRefundablePaymentListQuery>,
) {
  return [...adminRefundablePaymentListsQueryKey(), query] as const;
}
