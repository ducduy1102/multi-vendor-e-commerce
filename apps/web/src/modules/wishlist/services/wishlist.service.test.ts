import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import {
  addToWishlist,
  getWishlistStatus,
  listMyWishlist,
  removeFromWishlist,
} from './wishlist.service';

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

describe('wishlist.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getWishlistStatus GETs /wishlist/:productId/status, trả về đúng {isWishlisted}', async () => {
    mockFetchOnce({ success: true, data: { isWishlisted: true } });

    const result = await getWishlistStatus('product-1');

    expect(result).toEqual({ isWishlisted: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wishlist/product-1/status'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getWishlistStatus rethrows ApiError khi chưa đăng nhập (401)', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Unauthorized' }, 401);

    await expect(getWishlistStatus('product-1')).rejects.toMatchObject(
      new ApiError('Unauthorized', 401),
    );
  });

  it('addToWishlist POSTs /wishlist/:productId, trả về {isWishlisted: true}', async () => {
    mockFetchOnce({ success: true, data: { isWishlisted: true } }, 201);

    const result = await addToWishlist('product-1');

    expect(result).toEqual({ isWishlisted: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wishlist/product-1'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('removeFromWishlist DELETEs /wishlist/:productId, trả về {isWishlisted: false}', async () => {
    mockFetchOnce({ success: true, data: { isWishlisted: false } });

    const result = await removeFromWishlist('product-1');

    expect(result).toEqual({ isWishlisted: false });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wishlist/product-1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('listMyWishlist GETs /wishlist, trả về mảng item đã parse (kèm isAvailable)', async () => {
    const items = [
      {
        id: 'product-1',
        categoryId: 'cat-1',
        name: 'Áo thun nam',
        slug: 'ao-thun-nam',
        minPrice: '100000',
        maxPrice: '150000',
        imageUrl: null,
        avgRating: 4.2,
        reviewCount: 5,
        isAvailable: true,
      },
    ];
    mockFetchOnce({ success: true, data: { items } });

    const result = await listMyWishlist();

    expect(result).toEqual({ items });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wishlist'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('listMyWishlist trả mảng rỗng khi chưa wishlist gì', async () => {
    mockFetchOnce({ success: true, data: { items: [] } });

    const result = await listMyWishlist();

    expect(result).toEqual({ items: [] });
  });
});
