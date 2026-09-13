import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { createShop, getMyShop, updateShop } from './shop.service';

const mockShop = {
  id: 'shop-1',
  ownerId: 'user-1',
  name: 'Shop ABC',
  slug: 'shop-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('shop.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createShop returns the parsed shop on success', async () => {
    mockFetchOnce({ success: true, data: { shop: mockShop } }, 201);

    const result = await createShop({ name: 'Shop ABC' });

    expect(result).toEqual(mockShop);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shops'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('createShop throws ApiError with the BE message when the user already owns a shop', async () => {
    mockFetchOnce({ success: false, data: null, message: 'User already owns a shop' }, 409);

    await expect(createShop({ name: 'Shop ABC' })).rejects.toMatchObject(
      new ApiError('User already owns a shop', 409),
    );
  });

  it('getMyShop returns the parsed shop when the user has one', async () => {
    mockFetchOnce({ success: true, data: { shop: mockShop } });

    const result = await getMyShop();

    expect(result).toEqual(mockShop);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shops/me'),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('getMyShop returns null on 404 instead of throwing (user has no shop yet)', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Shop not found' }, 404);

    await expect(getMyShop()).resolves.toBeNull();
  });

  it('getMyShop rethrows ApiError for non-404 errors (e.g. not logged in)', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Unauthorized' }, 401);

    await expect(getMyShop()).rejects.toMatchObject(new ApiError('Unauthorized', 401));
  });

  it('updateShop PATCHes /shops/:id and returns the parsed shop', async () => {
    const updated = { ...mockShop, name: 'Tên mới' };
    mockFetchOnce({ success: true, data: { shop: updated } });

    const result = await updateShop('shop-1', { name: 'Tên mới' });

    expect(result).toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shops/shop-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Tên mới' }),
      }),
    );
  });
});
