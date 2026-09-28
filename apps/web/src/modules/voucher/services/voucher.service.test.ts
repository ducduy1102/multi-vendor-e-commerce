import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVoucher, listShopVouchers, setVoucherActive } from './voucher.service';

const VOUCHER = {
  id: 'voucher-1',
  shopId: 'shop-1',
  code: 'SALE10',
  type: 'PERCENT',
  value: '10',
  minOrderAmount: '200000',
  maxDiscountAmount: null,
  usageLimit: null,
  perUserLimit: null,
  usedCount: 0,
  isActive: true,
  expiresAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
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

describe('voucher.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createVoucher POST /shops/:shopId/vouchers, bóc {voucher}', async () => {
    mockFetchOnce({ success: true, data: { voucher: VOUCHER } }, 201);
    const values = { code: 'sale10', type: 'PERCENT' as const, value: 10 };

    const result = await createVoucher('shop-1', values);

    expect(result).toEqual(VOUCHER);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/vouchers$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(values);
  });

  it('createVoucher trùng mã — ApiError 409 giữ message của BE', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Voucher code already exists' }, 409);

    await expect(
      createVoucher('shop-1', { code: 'SALE10', type: 'PERCENT', value: 10 }),
    ).rejects.toMatchObject({ status: 409, message: 'Voucher code already exists' });
  });

  it('listShopVouchers GET /shops/:shopId/vouchers, trả {items}', async () => {
    mockFetchOnce({ success: true, data: { items: [VOUCHER] } });

    const result = await listShopVouchers('shop-1');

    expect(result.items).toEqual([VOUCHER]);
    expect(lastCall()[1].method).toBe('GET');
  });

  it('listShopVouchers — response sai shape ném lỗi parse', async () => {
    mockFetchOnce({ success: true, data: { items: [{ id: 1 }] } });

    await expect(listShopVouchers('shop-1')).rejects.toThrow();
  });

  it('setVoucherActive PATCH route lồng 2 cấp với {isActive}', async () => {
    mockFetchOnce({
      success: true,
      data: { voucher: { ...VOUCHER, isActive: false } },
    });

    const result = await setVoucherActive('shop-1', 'voucher-1', false);

    expect(result.isActive).toBe(false);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/vouchers\/voucher-1$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false });
  });
});
