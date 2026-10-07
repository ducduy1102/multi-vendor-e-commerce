import {
  orderDetailSchema,
  orderListResponseSchema,
  payAttemptResultSchema,
  sellerOrderDetailSchema,
  sellerOrderListResponseSchema,
  type CancelOrderInput,
  type OrderDetail,
  type OrderListQuery,
  type OrderListResponse,
  type PayAttemptResult,
  type RejectOrderInput,
  type SellerOrderDetail,
  type SellerOrderListQuery,
  type SellerOrderListResponse,
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

// Chỉ đơn COD chờ xác nhận (đơn đã trả online từ chối kèm hoàn tiền: Tuần 9); lý do BẮT BUỘC.
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
