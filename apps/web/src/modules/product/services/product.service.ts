import { z } from 'zod';
import {
  categorySchema,
  productDetailSchema,
  productListItemSchema,
  productListResponseSchema,
  productSchema,
  uploadSignatureSchema,
  type Category,
  type CreateProductInput,
  type ListProductsQuery,
  type Product,
  type ProductDetail,
  type ProductListItem,
  type ProductListResponse,
  type UpdateProductInput,
  type UploadSignature,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

export async function createProduct(shopId: string, values: CreateProductInput): Promise<Product> {
  const data = await apiFetch<{ product: unknown }>(`/shops/${shopId}/products`, {
    method: 'POST',
    body: JSON.stringify(values),
  });
  return productSchema.parse(data.product);
}

export async function getMyProducts(shopId: string): Promise<ProductListItem[]> {
  const data = await apiFetch<{ products: unknown }>(`/shops/${shopId}/products`, {
    method: 'GET',
  });
  return z.array(productListItemSchema).parse(data.products);
}

export async function updateProduct(id: string, values: UpdateProductInput): Promise<Product> {
  const data = await apiFetch<{ product: unknown }>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  });
  return productSchema.parse(data.product);
}

export async function archiveProduct(id: string): Promise<Product> {
  const data = await apiFetch<{ product: unknown }>(`/products/${id}`, {
    method: 'DELETE',
  });
  return productSchema.parse(data.product);
}

export async function getProduct(id: string): Promise<Product> {
  const data = await apiFetch<{ product: unknown }>(`/products/${id}`, {
    method: 'GET',
  });
  return productSchema.parse(data.product);
}

// Route public GET /products/:slug (khác getProduct(id) ở trên — dùng cho
// seller tự sửa sản phẩm của mình qua id thật). Trả thêm `shop: {name,
// slug}` nên parse riêng bằng productDetailSchema (Week5.md Bước 1.5/2.2-2.3,
// khớp ProductDetailSummary ở apps/api) — không dùng chung productSchema.
export async function getProductBySlug(slug: string): Promise<ProductDetail> {
  const data = await apiFetch<{ product: unknown }>(`/products/${slug}`, {
    method: 'GET',
  });
  return productDetailSchema.parse(data.product);
}

// params bỏ trống field nào thì không gửi param đó lên URL — để BE tự áp
// default (page=1, limit=12, sort=newest, xem listProductsQuerySchema),
// không tự lặp lại default ở đây (1 nguồn duy nhất, đúng rules/general.md
// mục 4).
export async function listProducts(
  params: Partial<ListProductsQuery> = {},
): Promise<ProductListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.sort !== undefined) searchParams.set('sort', params.sort);
  if (params.shopId !== undefined) searchParams.set('shopId', params.shopId);
  if (params.categoryId !== undefined) searchParams.set('categoryId', params.categoryId);
  if (params.minPrice !== undefined) searchParams.set('minPrice', String(params.minPrice));
  if (params.maxPrice !== undefined) searchParams.set('maxPrice', String(params.maxPrice));
  if (params.q !== undefined) searchParams.set('q', params.q);
  params.attributeValues?.forEach((value) => searchParams.append('attributeValues', value));

  const query = searchParams.toString();
  const data = await apiFetch<unknown>(`/products${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
  return productListResponseSchema.parse(data);
}

// FE tự upload thẳng lên Cloudinary bằng chữ ký này (Week4.md Bước 1.11
// hướng b, Bước 3.8) — BE không nhận file, chỉ ký.
export async function getUploadSignature(): Promise<UploadSignature> {
  const data = await apiFetch<unknown>('/uploads/signature', { method: 'POST' });
  return uploadSignatureSchema.parse(data);
}

// Category chưa có CRUD/module riêng (Admin category management để dành
// Tuần 11) — chỉ đọc, phục vụ shortcut category ở trang chủ (Bước 3.3) và
// dropdown filter category ở trang danh sách public (Bước 3.4).
export async function getCategories(): Promise<Category[]> {
  const data = await apiFetch<{ categories: unknown }>('/categories', {
    method: 'GET',
  });
  return z.array(categorySchema).parse(data.categories);
}
