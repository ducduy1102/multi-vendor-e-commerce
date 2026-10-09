import {
  adminRefundListResponseSchema,
  adminRefundRequestListResponseSchema,
  adminRefundRequestSchema,
  adminRefundSchema,
  adminRefundablePaymentListResponseSchema,
  adminShopListResponseSchema,
  adminShopSchema,
  type AdminDecideRefundRequestInput,
  type AdminMarkRefundCompletedInput,
  type AdminRefund,
  type AdminRefundListQuery,
  type AdminRefundListResponse,
  type AdminRefundPaymentInput,
  type AdminRefundRequest,
  type AdminRefundRequestListQuery,
  type AdminRefundRequestListResponse,
  type AdminRefundablePaymentListQuery,
  type AdminRefundablePaymentListResponse,
  type AdminShop,
  type AdminShopListQuery,
  type AdminShopListResponse,
  type AdminUpdateShopStatusInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Mọi danh sách của Admin chỉ lọc theo (tuỳ chọn) status + phân trang.
interface ListQueryParams {
  status?: string;
  page?: number;
  limit?: number;
}

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (status, page=1, limit=20, xem các
// admin*ListQuerySchema), không lặp lại default ở FE (1 nguồn duy nhất, rules/general.md mục 4).
function toListQueryString(params: ListQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.status !== undefined) searchParams.set('status', params.status);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// Chỉ ADMIN gọi được (RolesGuard ở BE — 401 chưa đăng nhập, 403 không phải ADMIN).
export async function listShops(
  params: Partial<AdminShopListQuery> = {},
): Promise<AdminShopListResponse> {
  const data = await apiFetch<unknown>(`/admin/shops${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminShopListResponseSchema.parse(data);
}

// Duyệt / từ chối / khoá / mở khoá. Từ chối và khoá bắt buộc `reason` (BE trả 400 nếu thiếu); shop
// không còn ở trạng thái hợp lệ để chuyển (đã có người xử lý) ⇒ 409 `SHOP_INVALID_TRANSITION`.
// BE bọc kết quả trong `{ shop }` (như PATCH /shops/:id).
export async function updateShopStatus(
  shopId: string,
  input: AdminUpdateShopStatusInput,
): Promise<AdminShop> {
  const data = await apiFetch<{ shop: unknown }>(`/admin/shops/${shopId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return adminShopSchema.parse(data.shop);
}

// --- Hoàn tiền (Week9.md 2.9) ---------------------------------------------------------------------
// Ba màn của Admin: hàng chờ khiếu nại, sổ cái hoàn tiền, thanh toán bất thường. Các cờ canApprove /
// canReject / canRetry / canMarkCompleted do BE tính — FE chỉ đọc. Mọi hành động trả lại CHÍNH dòng vừa
// đổi (yêu cầu hoặc khoản hoàn), không bọc trong `{ ... }`.

export async function listRefundRequests(
  params: Partial<AdminRefundRequestListQuery> = {},
): Promise<AdminRefundRequestListResponse> {
  const data = await apiFetch<unknown>(`/admin/refund-requests${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundRequestListResponseSchema.parse(data);
}

// Duyệt (ghi chú tuỳ chọn) hoặc từ chối (ghi chú BẮT BUỘC — BE trả 400 theo field `note`). Yêu cầu không
// còn ở trạng thái quyết định được (seller/Admin khác vừa xử lý, người mua vừa rút) ⇒ 409
// `REFUND_REQUEST_INVALID_TRANSITION`.
export async function decideRefundRequest(
  requestId: string,
  input: AdminDecideRefundRequestInput,
): Promise<AdminRefundRequest> {
  const data = await apiFetch<unknown>(`/admin/refund-requests/${requestId}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundRequestSchema.parse(data);
}

export async function listRefunds(
  params: Partial<AdminRefundListQuery> = {},
): Promise<AdminRefundListResponse> {
  const data = await apiFetch<unknown>(`/admin/refunds${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundListResponseSchema.parse(data);
}

// Gọi lại cổng cho khoản FAILED (hoặc PENDING bị bỏ dở quá 5 phút). Kết quả có thể vẫn FAILED/PENDING —
// vẫn là 200, FE đọc `status` của khoản trả về. 409 `PAYMENT_REFUND_NOT_RETRYABLE` = không còn ở trạng
// thái thử lại được (cờ `canRetry` đã cũ).
export async function retryRefund(refundId: string): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/refunds/${refundId}/retry`, { method: 'POST' });
  return adminRefundSchema.parse(data);
}

// Ghi nhận đã hoàn tay trên trang merchant của cổng: mã tham chiếu BẮT BUỘC (ghi thành
// 'MANUAL:<mã>'). Cùng điều kiện trạng thái với retry (409 `PAYMENT_REFUND_NOT_RETRYABLE`).
export async function markRefundCompleted(
  refundId: string,
  input: AdminMarkRefundCompletedInput,
): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/refunds/${refundId}/mark-completed`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundSchema.parse(data);
}

export async function listRefundablePayments(
  params: Partial<AdminRefundablePaymentListQuery> = {},
): Promise<AdminRefundablePaymentListResponse> {
  const data = await apiFetch<unknown>(`/admin/refundable-payments${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundablePaymentListResponseSchema.parse(data);
}

// Hoàn một thanh toán bất thường (đến muộn sau khi đơn đã hủy / trả hai lần) — không đụng đơn hay kho. Lý
// do tuỳ chọn. 409 `PAYMENT_NOT_REFUNDABLE` = không còn bất thường (đã có khoản hoàn, nhóm có đơn sống...).
export async function refundPayment(
  paymentId: string,
  input: AdminRefundPaymentInput = {},
): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundSchema.parse(data);
}
