import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import {
  addCartItem,
  getCart,
  mergeCart,
  quoteCart,
  removeCartItem,
  updateCartItem,
} from './cart.service';

const CART_VIEW = {
  shops: [],
  subtotal: '0',
  discount: null,
  grandTotal: '0',
  itemCount: 0,
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

describe('cart.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCart', () => {
    it('GET /cart, bóc {cart} ra CartView', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });

      const result = await getCart();

      expect(result).toEqual(CART_VIEW);
      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart$/);
      expect(init.method).toBe('GET');
    });

    it('có voucherCode — gắn vào query đã encode', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });

      await getCart('SALE 10');

      expect(lastCall()[0]).toContain('/cart?voucherCode=SALE%2010');
    });

    it('voucherCode chỉ khoảng trắng — không gắn query', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });

      await getCart('   ');

      expect(lastCall()[0]).toMatch(/\/cart$/);
    });

    it('response sai shape — parse Zod ném lỗi thay vì trả dữ liệu hỏng', async () => {
      mockFetchOnce({ success: true, data: { cart: { shops: 'x' } } });

      await expect(getCart()).rejects.toThrow();
    });

    it('rethrows ApiError khi chưa đăng nhập (401)', async () => {
      mockFetchOnce({ success: false, data: null, message: 'Unauthorized' }, 401);

      await expect(getCart()).rejects.toMatchObject(new ApiError('Unauthorized', 401));
    });

    it('mã voucher sai — giữ nguyên message lý do của BE trong ApiError', async () => {
      mockFetchOnce({ success: false, data: null, message: 'Voucher has expired' }, 400);

      await expect(getCart('OLD')).rejects.toMatchObject({
        status: 400,
        message: 'Voucher has expired',
      });
    });
  });

  describe('quoteCart', () => {
    it('POST /cart/quote với items và voucherCode', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });
      const items = [{ productVariantId: 'v1', quantity: 2 }];

      const result = await quoteCart(items, 'SALE10');

      expect(result).toEqual(CART_VIEW);
      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart\/quote$/);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        items,
        voucherCode: 'SALE10',
      });
    });

    it('voucherCode rỗng — không gửi field voucherCode', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });

      await quoteCart([], '  ');

      expect(JSON.parse(lastCall()[1].body as string)).toEqual({ items: [] });
    });
  });

  describe('mergeCart', () => {
    it('POST /cart/merge, trả giỏ mới', async () => {
      mockFetchOnce({ success: true, data: { cart: CART_VIEW } });
      const items = [{ productVariantId: 'v1', quantity: 1 }];

      const result = await mergeCart(items);

      expect(result).toEqual(CART_VIEW);
      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart\/merge$/);
      expect(JSON.parse(init.body as string)).toEqual({ items });
    });
  });

  describe('addCartItem / updateCartItem / removeCartItem', () => {
    const ROW = { id: 'item-1', productVariantId: 'v1', quantity: 3 };

    it('addCartItem POST /cart/items, trả dòng giỏ', async () => {
      mockFetchOnce({ success: true, data: { item: ROW } }, 201);

      const result = await addCartItem({ productVariantId: 'v1', quantity: 3 });

      expect(result).toEqual(ROW);
      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart\/items$/);
      expect(init.method).toBe('POST');
    });

    it('addCartItem vượt tồn kho — ApiError 409 giữ message của BE', async () => {
      mockFetchOnce(
        {
          success: false,
          data: null,
          message: 'Quantity exceeds available stock (3)',
        },
        409,
      );

      await expect(addCartItem({ productVariantId: 'v1', quantity: 9 })).rejects.toMatchObject({
        status: 409,
        message: 'Quantity exceeds available stock (3)',
      });
    });

    it('updateCartItem PATCH /cart/items/:itemId với quantity', async () => {
      mockFetchOnce({ success: true, data: { item: ROW } });

      const result = await updateCartItem('item-1', 3);

      expect(result).toEqual(ROW);
      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart\/items\/item-1$/);
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ quantity: 3 });
    });

    it('removeCartItem DELETE /cart/items/:itemId', async () => {
      mockFetchOnce({ success: true, data: { removed: true } });

      await expect(removeCartItem('item-1')).resolves.toBeUndefined();

      const [url, init] = lastCall();
      expect(url).toMatch(/\/cart\/items\/item-1$/);
      expect(init.method).toBe('DELETE');
    });
  });
});
