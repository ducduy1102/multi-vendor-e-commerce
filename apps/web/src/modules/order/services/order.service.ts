import {
  orderDetailSchema,
  orderListResponseSchema,
  payAttemptResultSchema,
  sellerOrderDetailSchema,
  sellerOrderListResponseSchema,
  sellerRefundRequestListItemSchema,
  sellerRefundRequestListResponseSchema,
  type ApproveRefundRequestInput,
  type CancelOrderInput,
  type CreateRefundRequestInput,
  type OrderDetail,
  type OrderListQuery,
  type OrderListResponse,
  type PayAttemptResult,
  type RejectOrderInput,
  type RejectRefundRequestInput,
  type SellerCancelOrderInput,
  type SellerOrderDetail,
  type SellerOrderListQuery,
  type SellerOrderListResponse,
  type SellerRefundRequestListItem,
  type SellerRefundRequestListQuery,
  type SellerRefundRequestListResponse,
  type ShipOrderInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (page=1, limit=10, xem
// orderListQuerySchema), không lặp lại default ở FE (1 nguồn duy nhất, rules/general.md mục 4).
function toListQueryString(params: Partial<OrderListQuery | SellerOrderListQuery>): string {
  const searchParams = new URLSearchParams();
  if (params.tab !== undefined) searchParams.set('tab', params.tab);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// --- Buyer ---------------------------------------------------------------------------------------
// Các cờ canCancel/canConfirmReceived/canRetryPayment do BE tính — FE không tự suy luật. Mọi hành
// động trả lại CHI TIẾT ĐƠN MỚI NHẤT (không bọc trong `{ order }`) để cập nhật cache ngay.

export async function listOrders(params: Partial<OrderListQuery> = {}): Promise<OrderListResponse> {
  const data = await apiFetch<unknown>(`/orders${toListQueryString(params)}`, { method: 'GET' });
  return orderListResponseSchema.parse(data);
}

export async function getOrder(orderId: string): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/orders/${orderId}`, { method: 'GET' });
  return orderDetailSchema.parse(data);
}

// Đơn chưa thanh toán ⇒ BE hủy CẢ NHÓM thanh toán (1 Payment cho N đơn) — cùng 1 endpoint, FE chỉ
// cần theo cờ canCancel. Lý do tuỳ chọn.
export async function cancelOrder(
  orderId: string,
  input: CancelOrderInput = {},
): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return orderDetailSchema.parse(data);
}

export async function confirmReceived(orderId: string): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/orders/${orderId}/confirm-received`, { method: 'POST' });
  return orderDetailSchema.parse(data);
}

// Yêu cầu hủy (đơn đã được shop xác nhận/đóng gói) hoặc trả hàng/hoàn tiền (đơn COMPLETED trong cửa sổ
// hoàn trả). Loại yêu cầu do BE suy từ trạng thái đơn, KHÔNG gửi từ client — FE chỉ gửi lý do. Trả chi tiết
// đơn mới nhất (`refundRequest` là yêu cầu vừa tạo, trạng thái PENDING_SELLER).
export async function requestRefund(
  orderId: string,
  input: CreateRefundRequestInput,
): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/orders/${orderId}/refund-requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return orderDetailSchema.parse(data);
}

// Rút yêu cầu khi seller CHƯA trả lời (cờ `refundRequest.canWithdraw` do BE tính). Trả chi tiết đơn mới
// nhất — `refundRequest` là null sau khi rút, người mua gửi lại yêu cầu mới được.
export async function withdrawRefundRequest(requestId: string): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/refund-requests/${requestId}/withdraw`, {
    method: 'POST',
  });
  return orderDetailSchema.parse(data);
}

// Khiếu nại lên sàn khi seller đã TỪ CHỐI (cờ `refundRequest.canEscalate`: một lần duy nhất, còn trong hạn).
export async function escalateRefundRequest(requestId: string): Promise<OrderDetail> {
  const data = await apiFetch<unknown>(`/refund-requests/${requestId}/escalate`, {
    method: 'POST',
  });
  return orderDetailSchema.parse(data);
}

// "Thanh toán lại" đơn chưa thanh toán: cùng endpoint với module checkout nhưng gọi bằng service
// RIÊNG của order (modules/order không được import modules/checkout). Thanh toán gắn theo NHÓM
// (1 Payment cho N đơn) nên nhận `checkoutGroupId` của đơn, không phải id đơn.
export async function retryPayment(groupId: string): Promise<PayAttemptResult> {
  const data = await apiFetch<unknown>(`/checkout/groups/${groupId}/pay`, { method: 'POST' });
  return payAttemptResultSchema.parse(data);
}

// --- Seller --------------------------------------------------------------------------------------
// shopId nằm trên URL để BE (ShopOwnerGuard) kiểm quyền sở hữu. Seller không bao giờ thấy đơn
// AWAITING_PAYMENT — BE lọc, sellerOrderTabSchema cũng không có tab đó.

export async function listSellerOrders(
  shopId: string,
  params: Partial<SellerOrderListQuery> = {},
): Promise<SellerOrderListResponse> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders${toListQueryString(params)}`, {
    method: 'GET',
  });
  return sellerOrderListResponseSchema.parse(data);
}

export async function getSellerOrder(shopId: string, orderId: string): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}`, { method: 'GET' });
  return sellerOrderDetailSchema.parse(data);
}

export async function confirmOrder(shopId: string, orderId: string): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}/confirm`, {
    method: 'POST',
  });
  return sellerOrderDetailSchema.parse(data);
}

export async function packOrder(shopId: string, orderId: string): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}/pack`, {
    method: 'POST',
  });
  return sellerOrderDetailSchema.parse(data);
}

// carrier/trackingCode nhập tay và đều tuỳ chọn (shop nhỏ có thể tự giao).
export async function shipOrder(
  shopId: string,
  orderId: string,
  input: ShipOrderInput = {},
): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}/ship`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sellerOrderDetailSchema.parse(data);
}

// Đơn chờ xác nhận (PENDING), MỌI phương thức thanh toán — đơn đã trả online được hoàn tiền tự động;
// lý do BẮT BUỘC.
export async function rejectOrder(
  shopId: string,
  orderId: string,
  input: RejectOrderInput,
): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}/reject`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sellerOrderDetailSchema.parse(data);
}

// Seller tự hủy đơn đã xác nhận/đóng gói (CONFIRMED/PACKED); lý do BẮT BUỘC. Khác `rejectOrder` ở trạng thái
// áp dụng. Nếu người mua đang có yêu cầu hủy chờ xử lý thì yêu cầu đó đóng luôn (cờ `canCancel` do BE tính).
export async function cancelSellerOrder(
  shopId: string,
  orderId: string,
  input: SellerCancelOrderInput,
): Promise<SellerOrderDetail> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sellerOrderDetailSchema.parse(data);
}

// --- Seller: yêu cầu hủy/trả hàng của người mua ---------------------------------------------------
// Hàng chờ xếp theo hạn phản hồi (cũ nhất trước). Yêu cầu người mua đã rút không bao giờ hiện cho seller
// (BE lọc, `status` ở query cũng không nhận WITHDRAWN). Cờ canApprove/canReject do BE tính.

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (page=1, limit), như toListQueryString.
function toRefundRequestQueryString(params: Partial<SellerRefundRequestListQuery>): string {
  const searchParams = new URLSearchParams();
  if (params.status !== undefined) searchParams.set('status', params.status);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function listSellerRefundRequests(
  shopId: string,
  params: Partial<SellerRefundRequestListQuery> = {},
): Promise<SellerRefundRequestListResponse> {
  const data = await apiFetch<unknown>(
    `/shops/${shopId}/refund-requests${toRefundRequestQueryString(params)}`,
    { method: 'GET' },
  );
  return sellerRefundRequestListResponseSchema.parse(data);
}

// Duyệt: ghi chú tuỳ chọn. Yêu cầu HỦY đã lên sàn cũng duyệt được (seller nhượng bộ); yêu cầu TRẢ HÀNG đã
// lên sàn thì Admin quyết định (409 REFUND_REQUEST_INVALID_TRANSITION). Duyệt = đơn bị hủy/hoàn, kho và
// tiền xử lý ở BE. Trả chính yêu cầu đó sau khi duyệt (không phải chi tiết đơn).
export async function approveRefundRequest(
  shopId: string,
  requestId: string,
  input: ApproveRefundRequestInput = {},
): Promise<SellerRefundRequestListItem> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/refund-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sellerRefundRequestListItemSchema.parse(data);
}

// Từ chối: ghi chú BẮT BUỘC (người mua đọc được lý do và có thể khiếu nại lên sàn).
export async function rejectRefundRequest(
  shopId: string,
  requestId: string,
  input: RejectRefundRequestInput,
): Promise<SellerRefundRequestListItem> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/refund-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return sellerRefundRequestListItemSchema.parse(data);
}
