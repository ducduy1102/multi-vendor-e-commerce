import {
  ownerAppealSchema,
  shopAppealsResponseSchema,
  type CreateAppealInput,
  type OwnerAppeal,
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
