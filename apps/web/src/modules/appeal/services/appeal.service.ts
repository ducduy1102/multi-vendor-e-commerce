import {
  ownerAppealSchema,
  productAppealsResponseSchema,
  shopAppealsResponseSchema,
  type CreateAppealInput,
  type OwnerAppeal,
  type ProductAppealsResponse,
  type ShopAppealsResponse,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Lịch sử kháng nghị của shop (mới nhất trước) kèm `canAppeal` do SERVER tính — FE không tự suy luật "được kháng nghị khi nào".
// Chỉ chủ shop gọi được (403 nếu không phải chủ shop, 404 nếu shop không tồn tại).
export async function getShopAppeals(shopId: string): Promise<ShopAppealsResponse> {
  const data = await apiFetch<unknown>(`/shops/${encodeURIComponent(shopId)}/appeals`, {
    method: 'GET',
  });
  return shopAppealsResponseSchema.parse(data);
}

// Gửi kháng nghị cho lần khoá hiện tại. Người gửi lấy từ phiên và mốc bị khoá do server đọc — body chỉ có `message`. BE trả
// thẳng kháng nghị vừa tạo (không bọc). 409 `APPEAL_NOT_ALLOWED` (shop không còn ở trạng thái được kháng nghị) hoặc
// `APPEAL_ALREADY_SENT` (lần khoá này đã có kháng nghị); 403 `EMAIL_NOT_VERIFIED` khi chưa xác thực email.
export async function createShopAppeal(
  shopId: string,
  input: CreateAppealInput,
): Promise<OwnerAppeal> {
  const data = await apiFetch<unknown>(`/shops/${encodeURIComponent(shopId)}/appeals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ownerAppealSchema.parse(data);
}

// Lịch sử kháng nghị của MỘT sản phẩm (mới nhất trước) kèm `canAppeal` do SERVER tính (Week11.md 5.8) — FE không tự suy luật "được kháng
// nghị khi nào". Chỉ chủ shop gọi được; sản phẩm không tồn tại / không thuộc shop này ra cùng một 404.
export async function getProductAppeals(
  shopId: string,
  productId: string,
): Promise<ProductAppealsResponse> {
  const data = await apiFetch<unknown>(
    `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/appeals`,
    { method: 'GET' },
  );
  return productAppealsResponseSchema.parse(data);
}

// Gửi kháng nghị cho lần gỡ hiện tại của sản phẩm. Người gửi lấy từ phiên và mốc bị gỡ do server đọc — body chỉ có `message`. Lỗi như
// `createShopAppeal`: 409 `APPEAL_NOT_ALLOWED` (sản phẩm không còn bị gỡ) hoặc `APPEAL_ALREADY_SENT` (lần gỡ này đã có kháng nghị),
// 403 `EMAIL_NOT_VERIFIED` khi chưa xác thực email.
export async function createProductAppeal(
  shopId: string,
  productId: string,
  input: CreateAppealInput,
): Promise<OwnerAppeal> {
  const data = await apiFetch<unknown>(
    `/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/appeals`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return ownerAppealSchema.parse(data);
}
