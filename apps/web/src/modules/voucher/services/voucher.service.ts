import {
  voucherListResponseSchema,
  voucherSchema,
  type CreateVoucherInput,
  type Voucher,
  type VoucherListResponse,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Chỉ dành cho Seller quản lý voucher của shop mình (Week6.md 1.14). Áp mã vào
// giỏ hàng đi qua module cart (?voucherCode / quote), không có API validate
// riêng. shopId nằm trên URL để BE (ShopOwnerGuard) kiểm quyền sở hữu.
export async function createVoucher(shopId: string, values: CreateVoucherInput): Promise<Voucher> {
  const data = await apiFetch<{ voucher: unknown }>(`/shops/${shopId}/vouchers`, {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return voucherSchema.parse(data.voucher);
}

export async function listShopVouchers(shopId: string): Promise<VoucherListResponse> {
  const data = await apiFetch<unknown>(`/shops/${shopId}/vouchers`, {
    method: 'GET',
  });
  return voucherListResponseSchema.parse(data);
}

// Bật/tắt tường minh (idempotent), không phải "đảo trạng thái".
export async function setVoucherActive(
  shopId: string,
  voucherId: string,
  isActive: boolean,
): Promise<Voucher> {
  const data = await apiFetch<{ voucher: unknown }>(`/shops/${shopId}/vouchers/${voucherId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  return voucherSchema.parse(data.voucher);
}
