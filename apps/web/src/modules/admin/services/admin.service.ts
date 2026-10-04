import {
  adminShopListResponseSchema,
  adminShopSchema,
  type AdminShop,
  type AdminShopListQuery,
  type AdminShopListResponse,
  type AdminUpdateShopStatusInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (status=PENDING, page=1, limit=20,
// xem adminShopListQuerySchema), không lặp lại default ở FE (1 nguồn duy nhất, rules/general.md mục 4).
function toListQueryString(params: Partial<AdminShopListQuery>): string {
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
