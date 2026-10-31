import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeOwnerAppeal } from '../appeal.fixtures';
import {
  createProductAppeal,
  createShopAppeal,
  getProductAppeals,
  getShopAppeals,
} from './appeal.service';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appeal.service — getShopAppeals', () => {
  it('GET /shops/:shopId/appeals kèm cookie, parse đúng schema (lịch sử + canAppeal)', async () => {
    mockFetchOnce({
      success: true,
      data: { appeals: [makeOwnerAppeal()], canAppeal: true },
    });

    const result = await getShopAppeals(SHOP_ID);

    expect(result.canAppeal).toBe(true);
    expect(result.appeals).toHaveLength(1);
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/shops/${SHOP_ID}/appeals$`));
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('id đưa vào đường dẫn được mã hoá (không thể chèn đoạn đường dẫn khác)', async () => {
    mockFetchOnce({ success: true, data: { appeals: [], canAppeal: false } });

    await getShopAppeals('a/b?x=1');

    expect(lastCall()[0]).toMatch(/\/shops\/a%2Fb%3Fx%3D1\/appeals$/);
  });

  it('field thừa của BE (vd id Admin quyết định) bị bỏ khi parse — FE không bao giờ giữ chúng', async () => {
    mockFetchOnce({
      success: true,
      data: {
        appeals: [{ ...makeOwnerAppeal(), decidedById: 'admin-1', decidedByName: 'Quản trị' }],
        canAppeal: false,
      },
    });

    const result = await getShopAppeals(SHOP_ID);

    expect(JSON.stringify(result)).not.toMatch(/decidedBy|admin-1|Quản trị/);
  });

  it('response sai hình dạng (thiếu canAppeal) ⇒ ném lỗi thay vì trả dữ liệu hỏng', async () => {
    mockFetchOnce({ success: true, data: { appeals: [] } });

    await expect(getShopAppeals(SHOP_ID)).rejects.toThrow();
  });

  it('403 (không phải chủ shop) ⇒ ném ApiError mang status', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Not the shop owner' }, 403);

    await expect(getShopAppeals(SHOP_ID)).rejects.toMatchObject({ status: 403 });
  });
});

describe('appeal.service — createShopAppeal', () => {
  it('POST /shops/:shopId/appeals với body CHỈ có message, trả kháng nghị vừa tạo (không bọc)', async () => {
    mockFetchOnce({ success: true, data: makeOwnerAppeal({ message: 'Xin xem xét lại' }) }, 201);

    const result = await createShopAppeal(SHOP_ID, { message: 'Xin xem xét lại' });

    expect(result).toMatchObject({ state: 'PENDING', message: 'Xin xem xét lại' });
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/shops/${SHOP_ID}/appeals$`));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Xin xem xét lại' });
  });

  it.each([
    [409, 'APPEAL_NOT_ALLOWED'],
    [409, 'APPEAL_ALREADY_SENT'],
    [403, 'EMAIL_NOT_VERIFIED'],
  ])('%i %s ⇒ ném ApiError mang đúng status và mã lỗi nghiệp vụ', async (status, code) => {
    mockFetchOnce({ success: false, data: null, message: code, code }, status);

    await expect(createShopAppeal(SHOP_ID, { message: 'x' })).rejects.toMatchObject({
      status,
      code,
    });
  });
});

// Kháng nghị sản phẩm bị gỡ (Week11.md 5.8).
describe('appeal.service — getProductAppeals', () => {
  it('GET /shops/:shopId/products/:productId/appeals kèm cookie, parse đúng schema (lịch sử + canAppeal)', async () => {
    mockFetchOnce({
      success: true,
      data: { appeals: [makeOwnerAppeal()], canAppeal: true },
    });

    const result = await getProductAppeals(SHOP_ID, PRODUCT_ID);

    expect(result.canAppeal).toBe(true);
    expect(result.appeals).toHaveLength(1);
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/shops/${SHOP_ID}/products/${PRODUCT_ID}/appeals$`));
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('cả hai id đưa vào đường dẫn đều được mã hoá (không thể chèn đoạn đường dẫn khác)', async () => {
    mockFetchOnce({ success: true, data: { appeals: [], canAppeal: false } });

    await getProductAppeals('a/b', 'c?x=1');

    expect(lastCall()[0]).toMatch(/\/shops\/a%2Fb\/products\/c%3Fx%3D1\/appeals$/);
  });

  it('field thừa của BE (vd id Admin quyết định) bị bỏ khi parse', async () => {
    mockFetchOnce({
      success: true,
      data: {
        appeals: [{ ...makeOwnerAppeal(), decidedById: 'admin-1', decidedByName: 'Quản trị' }],
        canAppeal: false,
      },
    });

    const result = await getProductAppeals(SHOP_ID, PRODUCT_ID);

    expect(JSON.stringify(result)).not.toMatch(/decidedBy|admin-1|Quản trị/);
  });

  it('response sai hình dạng (thiếu canAppeal) ⇒ ném lỗi thay vì trả dữ liệu hỏng', async () => {
    mockFetchOnce({ success: true, data: { appeals: [] } });

    await expect(getProductAppeals(SHOP_ID, PRODUCT_ID)).rejects.toThrow();
  });

  it('404 (sản phẩm không thuộc shop / không tồn tại) ⇒ ném ApiError mang status', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Product not found' }, 404);

    await expect(getProductAppeals(SHOP_ID, PRODUCT_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('appeal.service — createProductAppeal', () => {
  it('POST /shops/:shopId/products/:productId/appeals với body CHỈ có message, trả kháng nghị vừa tạo (không bọc)', async () => {
    mockFetchOnce({ success: true, data: makeOwnerAppeal({ message: 'Xin xem xét lại' }) }, 201);

    const result = await createProductAppeal(SHOP_ID, PRODUCT_ID, { message: 'Xin xem xét lại' });

    expect(result).toMatchObject({ state: 'PENDING', message: 'Xin xem xét lại' });
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/shops/${SHOP_ID}/products/${PRODUCT_ID}/appeals$`));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Xin xem xét lại' });
  });

  it.each([
    [409, 'APPEAL_NOT_ALLOWED'],
    [409, 'APPEAL_ALREADY_SENT'],
    [403, 'EMAIL_NOT_VERIFIED'],
  ])('%i %s ⇒ ném ApiError mang đúng status và mã lỗi nghiệp vụ', async (status, code) => {
    mockFetchOnce({ success: false, data: null, message: code, code }, status);

    await expect(createProductAppeal(SHOP_ID, PRODUCT_ID, { message: 'x' })).rejects.toMatchObject({
      status,
      code,
    });
  });
});
