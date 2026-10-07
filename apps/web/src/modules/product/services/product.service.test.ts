import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import {
  archiveProduct,
  createProduct,
  getCategories,
  getMyProducts,
  getProduct,
  getProductBySlug,
  getUploadSignature,
  listProducts,
  updateProduct,
} from './product.service';

const mockProduct = {
  id: 'product-1',
  shopId: 'shop-1',
  categoryId: 'cat-1',
  name: 'Áo thun nam',
  slug: 'ao-thun-nam',
  description: null,
  status: 'DRAFT',
  minPrice: '150000',
  maxPrice: '150000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  attributes: [],
  variants: [
    {
      id: 'variant-1',
      sku: 'AT-1',
      price: '150000',
      stock: 10,
      isActive: true,
      images: [],
      weightGram: null,
      attributeValues: [],
    },
  ],
};

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('product.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createProduct POSTs /shops/:shopId/products và trả về product đã parse', async () => {
    mockFetchOnce({ success: true, data: { product: mockProduct } }, 201);

    const result = await createProduct('shop-1', {
      name: 'Áo thun nam',
      categoryId: 'cat-1',
      attributes: [],
      variants: [{ sku: 'AT-1', price: 150000, stock: 10, attributeValues: [], images: [] }],
    });

    expect(result).toEqual(mockProduct);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shops/shop-1/products'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('createProduct throws ApiError đúng message khi SKU đã tồn tại trong shop (409)', async () => {
    mockFetchOnce({ success: false, data: null, message: 'SKU already exists in this shop' }, 409);

    await expect(
      createProduct('shop-1', {
        name: 'Áo thun nam',
        categoryId: 'cat-1',
        attributes: [],
        variants: [{ sku: 'AT-1', price: 150000, stock: 10, attributeValues: [], images: [] }],
      }),
    ).rejects.toMatchObject(new ApiError('SKU already exists in this shop', 409));
  });

  it('getMyProducts GETs /shops/:shopId/products và trả về mảng product list item', async () => {
    const listItem = {
      id: mockProduct.id,
      categoryId: mockProduct.categoryId,
      name: mockProduct.name,
      slug: mockProduct.slug,
      status: mockProduct.status,
      minPrice: mockProduct.minPrice,
      maxPrice: mockProduct.maxPrice,
      createdAt: mockProduct.createdAt,
      updatedAt: mockProduct.updatedAt,
      variants: mockProduct.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        price: v.price,
        stock: v.stock,
        isActive: v.isActive,
        images: v.images,
      })),
    };
    mockFetchOnce({ success: true, data: { products: [listItem] } });

    const result = await getMyProducts('shop-1');

    expect(result).toEqual([listItem]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shops/shop-1/products'),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('updateProduct PATCHes /products/:id kèm đúng body', async () => {
    const updated = { ...mockProduct, name: 'Tên mới', status: 'PUBLISHED' };
    mockFetchOnce({ success: true, data: { product: updated } });

    const result = await updateProduct('product-1', { name: 'Tên mới', status: 'PUBLISHED' });

    expect(result).toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/products/product-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Tên mới', status: 'PUBLISHED' }),
      }),
    );
  });

  it('archiveProduct DELETEs /products/:id, trả về product với status ARCHIVED (không xoá cứng)', async () => {
    const archived = { ...mockProduct, status: 'ARCHIVED' };
    mockFetchOnce({ success: true, data: { product: archived } });

    const result = await archiveProduct('product-1');

    expect(result.status).toBe('ARCHIVED');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/products/product-1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getProduct GETs /products/:id, rethrows ApiError 404 khi không tồn tại/không được xem', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Product not found' }, 404);

    await expect(getProduct('khong-ton-tai')).rejects.toMatchObject(
      new ApiError('Product not found', 404),
    );
  });

  it('getProductBySlug GETs /products/:slug, parse kèm field shop (khác getProduct)', async () => {
    const productDetail = {
      ...mockProduct,
      variants: [
        {
          id: 'variant-1',
          sku: 'AT-1',
          price: '150000',
          stock: 10,
          isActive: true,
          images: [],
          weightGram: null,
          attributeValues: [],
        },
      ],
      shop: { name: 'Shop ABC', slug: 'shop-abc' },
      // Điểm đánh giá denormalized (Week9.md 1.8): response public của chi tiết luôn có.
      avgRating: 4.5,
      reviewCount: 12,
    };
    mockFetchOnce({ success: true, data: { product: productDetail } });

    const result = await getProductBySlug('ao-thun-nam');

    expect(result).toEqual(productDetail);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/products/ao-thun-nam'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getProductBySlug rethrows ApiError 404 khi slug không tồn tại/không được xem', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Product not found' }, 404);

    await expect(getProductBySlug('khong-ton-tai')).rejects.toMatchObject(
      new ApiError('Product not found', 404),
    );
  });

  it('listProducts chỉ gửi param đã có giá trị, bỏ qua field undefined (để BE tự áp default)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 12 } });

    await listProducts({ categoryId: 'cat-1', sort: 'price-asc' });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('categoryId=cat-1');
    expect(calledUrl).toContain('sort=price-asc');
    expect(calledUrl).not.toContain('page=');
    expect(calledUrl).not.toContain('limit=');
    expect(calledUrl).not.toContain('minPrice=');
    expect(calledUrl).not.toContain('q=');
  });

  it('listProducts gửi kèm param q khi có (Week5.md Bước 3.6 — thanh search)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 12 } });

    await listProducts({ q: 'áo thun' });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(calledUrl).searchParams.get('q')).toBe('áo thun');
  });

  it('listProducts append nhiều lần cho attributeValues[] (không ghi đè, mỗi giá trị 1 param riêng)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 12 } });

    await listProducts({ attributeValues: ['Đỏ', 'M'] });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const params = new URL(calledUrl).searchParams.getAll('attributeValues');
    expect(params).toEqual(['Đỏ', 'M']);
  });

  it('getUploadSignature POSTs /uploads/signature, trả về signature đã parse', async () => {
    const signature = {
      signature: 'abc123',
      timestamp: 1234567890,
      apiKey: 'api-key',
      cloudName: 'ducduydev',
    };
    mockFetchOnce({ success: true, data: signature }, 201);

    const result = await getUploadSignature();

    expect(result).toEqual(signature);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/signature'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getCategories GETs /categories, trả về mảng category đã parse', async () => {
    const categories = [
      { id: 'cat-1', name: 'Thời trang', slug: 'thoi-trang', parentId: null },
      { id: 'cat-2', name: 'Áo nam', slug: 'ao-nam', parentId: 'cat-1' },
    ];
    mockFetchOnce({ success: true, data: { categories } });

    const result = await getCategories();

    expect(result).toEqual(categories);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/categories'),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
