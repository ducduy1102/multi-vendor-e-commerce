import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { createShop, getMyShop, updateShop, resubmitShop } from './shop.service';

const mockShop = {
  id: 'shop-1',
  ownerId: 'user-1',
  name: 'Shop ABC',
  slug: 'shop-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  statusChangedAt: '2026-01-01T00:00:00.000Z',
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

  it('resubmitShop POSTs /shops/:id/resubmit with the edited fields and returns the parsed shop', async () => {
    const resubmitted = { ...mockShop, name: 'Tên đã sửa', status: 'PENDING' };
    mockFetchOnce({ success: true, data: { shop: resubmitted } });

    const result = await resubmitShop('shop-1', { name: 'Tên đã sửa' });

    expect(result).toEqual(resubmitted);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/shops\/shop-1\/resubmit$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ name: 'Tên đã sửa' }),
      }),
    );
  });

  it('resubmitShop with {} resubmits without changing anything (valid body)', async () => {
    mockFetchOnce({ success: true, data: { shop: { ...mockShop, status: 'PENDING' } } });

    await resubmitShop('shop-1', {});

    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ body: '{}' }));
  });

  it('resubmitShop keeps the error code of a 409 so the UI can translate it', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Cannot change shop status from APPROVED to PENDING',
        code: 'SHOP_INVALID_TRANSITION',
      },
      409,
    );

    await expect(resubmitShop('shop-1', {})).rejects.toMatchObject({
      status: 409,
      code: 'SHOP_INVALID_TRANSITION',
    });
  });

  it('updateShop keeps SHOP_EDIT_NOT_ALLOWED + details.status from a 409', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Shop details cannot be edited while the shop is PENDING',
        code: 'SHOP_EDIT_NOT_ALLOWED',
        details: { status: 'PENDING' },
      },
      409,
    );

    await expect(updateShop('shop-1', { name: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'SHOP_EDIT_NOT_ALLOWED',
      details: { status: 'PENDING' },
    });
  });

  it('rejects a shop response that lacks statusChangedAt (contract: FE needs it, z.object would strip it silently)', async () => {
    const { statusChangedAt: _omitted, ...withoutChangedAt } = mockShop;
    void _omitted;
    mockFetchOnce({ success: true, data: { shop: withoutChangedAt } });

    await expect(updateShop('shop-1', { name: 'x' })).rejects.toThrow();
  });
});
