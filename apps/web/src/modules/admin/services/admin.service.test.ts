import { afterEach, describe, expect, it, vi } from 'vitest';

import { listShops, updateShopStatus } from './admin.service';

const SHOP = {
  id: 'shop-1',
  ownerId: 'user-1',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  lastRejectionReason: null,
  resubmissionCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
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

function lastCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
}

describe('admin.service — listShops', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('không tham số -> GET /admin/shops (không tự gửi default), kèm cookie, parse đúng schema', async () => {
    mockFetchOnce({ success: true, data: { items: [SHOP], total: 1, page: 1, limit: 20 } });

    const result = await listShops();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].owner.email).toBe('nguyenvana@example.com');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/shops$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('gửi status/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listShops({ status: 'SUSPENDED', page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(/\/admin\/shops\?status=SUSPENDED&page=2&limit=5$/);

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });
    await listShops({ status: undefined, page: 3 });
    expect(lastCall()[0]).toMatch(/\/admin\/shops\?page=3$/);
  });

  it('response sai hình dạng (thiếu owner) -> Zod từ chối thay vì để UI đọc undefined', async () => {
    const { owner, ...withoutOwner } = SHOP;
    void owner;
    mockFetchOnce({ success: true, data: { items: [withoutOwner], total: 1, page: 1, limit: 20 } });

    await expect(listShops()).rejects.toThrow();
  });

  it('403 (không phải ADMIN) -> ApiError giữ status để hook không thử lại', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, 403);

    await expect(listShops()).rejects.toMatchObject({ status: 403 });
  });
});

describe('admin.service — updateShopStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCH /admin/shops/:id/status với body {status, reason}, lấy shop trong { shop }', async () => {
    mockFetchOnce({
      success: true,
      data: { shop: { ...SHOP, status: 'SUSPENDED', statusReason: 'Hàng cấm' } },
    });

    const shop = await updateShopStatus('shop-1', { status: 'SUSPENDED', reason: 'Hàng cấm' });

    expect(shop.status).toBe('SUSPENDED');
    expect(shop.statusReason).toBe('Hàng cấm');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/shops\/shop-1\/status$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'SUSPENDED', reason: 'Hàng cấm' });
  });

  it('duyệt không có lý do -> body chỉ có status', async () => {
    mockFetchOnce({ success: true, data: { shop: { ...SHOP, status: 'APPROVED' } } });

    await updateShopStatus('shop-1', { status: 'APPROVED' });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ status: 'APPROVED' });
  });

  it('409 SHOP_INVALID_TRANSITION (Admin khác vừa xử lý) giữ code để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Cannot change shop status from APPROVED to APPROVED',
        code: 'SHOP_INVALID_TRANSITION',
      },
      409,
    );

    await expect(updateShopStatus('shop-1', { status: 'APPROVED' })).rejects.toMatchObject({
      status: 409,
      code: 'SHOP_INVALID_TRANSITION',
    });
  });

  it('400 thiếu lý do (BE từ chối) -> ApiError status 400', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'reason: admin.validationReasonRequired' },
      400,
    );

    await expect(updateShopStatus('shop-1', { status: 'REJECTED' })).rejects.toMatchObject({
      status: 400,
    });
  });
});
