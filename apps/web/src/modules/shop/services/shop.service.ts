import {
  shopSchema,
  type CreateShopInput,
  type Shop,
  type UpdateShopInput,
} from '@ecommerce/types';

import { ApiError, apiFetch } from '@/shared/lib/api-client';

export async function createShop(values: CreateShopInput): Promise<Shop> {
  const data = await apiFetch<{ shop: unknown }>('/shops', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return shopSchema.parse(data.shop);
}

// 404 nghĩa là user chưa có shop (chưa phải seller) — trả null để FE phân
// biệt với lỗi thật khác, thay vì để ApiError văng lên tận UI.
export async function getMyShop(): Promise<Shop | null> {
  try {
    const data = await apiFetch<{ shop: unknown }>('/shops/me', {
      method: 'GET',
    });
    return shopSchema.parse(data.shop);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateShop(id: string, values: UpdateShopInput): Promise<Shop> {
  const data = await apiFetch<{ shop: unknown }>(`/shops/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  });
  return shopSchema.parse(data.shop);
}
