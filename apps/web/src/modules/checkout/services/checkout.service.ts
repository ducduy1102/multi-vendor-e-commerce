import {
  addressListResponseSchema,
  addressResponseSchema,
  checkoutGroupSchema,
  checkoutResultSchema,
  payAttemptResultSchema,
  type Address,
  type CheckoutGroup,
  type CheckoutResult,
  type CreateAddressInput,
  type PayAttemptResult,
  type PlaceOrderInput,
  type UpdateAddressInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Chỉ gọi API (`/addresses`, `/checkout`), không có logic UI. Mọi response
// parse bằng Zod từ packages/types — cùng schema BE dùng để validate request,
// nên FE/BE không lệch shape (rules/general.md mục 4). `POST /checkout/preview`
// (2.7b) chưa cần ở bước này — 3.4 sẽ thêm khi dựng trang /checkout.

export async function listAddresses(): Promise<Address[]> {
  const data = await apiFetch<unknown>('/addresses', { method: 'GET' });
  return addressListResponseSchema.parse(data).addresses;
}

export async function createAddress(input: CreateAddressInput): Promise<Address> {
  const data = await apiFetch<unknown>('/addresses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return addressResponseSchema.parse(data).address;
}

export async function updateAddress(id: string, input: UpdateAddressInput): Promise<Address> {
  const data = await apiFetch<unknown>(`/addresses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return addressResponseSchema.parse(data).address;
}

export async function deleteAddress(id: string): Promise<void> {
  await apiFetch<unknown>(`/addresses/${id}`, { method: 'DELETE' });
}

export async function setDefaultAddress(id: string): Promise<Address> {
  const data = await apiFetch<unknown>(`/addresses/${id}/default`, {
    method: 'PATCH',
  });
  return addressResponseSchema.parse(data).address;
}

// Header Idempotency-Key (1.11) — phiên đặt hàng ở /checkout (3.4) tự sinh UUID
// và truyền vào; không bắt buộc ở tầng service vì BE khai `required: false`.
export async function placeOrder(
  input: PlaceOrderInput,
  idempotencyKey?: string,
): Promise<CheckoutResult> {
  const data = await apiFetch<unknown>('/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
  return checkoutResultSchema.parse(data);
}

export async function getCheckoutGroup(groupId: string): Promise<CheckoutGroup> {
  const data = await apiFetch<unknown>(`/checkout/groups/${groupId}`, {
    method: 'GET',
  });
  return checkoutGroupSchema.parse(data);
}

// Tiếp tục thanh toán / thanh toán lại — BE trả payUrl đã lưu (200) hoặc lần
// thử mới (201), body luôn khớp payAttemptResultSchema (status không lộ ra FE).
export async function retryPayment(groupId: string): Promise<PayAttemptResult> {
  const data = await apiFetch<unknown>(`/checkout/groups/${groupId}/pay`, {
    method: 'POST',
  });
  return payAttemptResultSchema.parse(data);
}
