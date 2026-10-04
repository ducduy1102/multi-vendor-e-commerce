import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAddress,
  deleteAddress,
  getCheckoutGroup,
  listAddresses,
  placeOrder,
  previewCheckout,
  retryPayment,
  setDefaultAddress,
  updateAddress,
} from './checkout.service';

const ADDRESS = {
  id: 'address-1',
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
  isDefault: true,
  createdAt: '2026-09-27T00:00:00.000Z',
};

const CHECKOUT_RESULT = {
  checkoutGroupId: 'group-1',
  orders: [{ id: 'order-1', shopId: 'shop-1', status: 'AWAITING_PAYMENT', totalAmount: '320000' }],
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  expiresAt: '2026-09-27T04:15:00.000Z',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...',
};

const CHECKOUT_GROUP = {
  id: 'group-1',
  status: 'AWAITING_PAYMENT',
  canRetry: true,
  expiresAt: '2026-09-27T04:15:00.000Z',
  createdAt: '2026-09-27T04:00:00.000Z',
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  latestPaymentStatus: 'PENDING',
  orders: [
    {
      id: 'order-1',
      shopId: 'shop-1',
      shopName: 'Shop Áo Xinh',
      status: 'AWAITING_PAYMENT',
      subtotal: '300000',
      discountAmount: '0',
      shippingFee: '20000',
      totalAmount: '320000',
      items: [
        {
          productName: 'Áo thun',
          variantLabel: 'Size M / Đen',
          sku: 'AO-M-DEN',
          imageUrl: null,
          quantity: 1,
          priceAtPurchase: '300000',
        },
      ],
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

function lastCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
}

describe('checkout.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listAddresses GET /addresses, bóc {addresses}', async () => {
    mockFetchOnce({ success: true, data: { addresses: [ADDRESS] } });

    const result = await listAddresses();

    expect(result).toEqual([ADDRESS]);
    expect(lastCall()[1].method).toBe('GET');
  });

  it('createAddress POST /addresses, bóc {address}', async () => {
    mockFetchOnce({ success: true, data: { address: ADDRESS } }, 201);
    const input = {
      recipientName: 'Nguyễn Văn A',
      phone: '0912345678',
      line1: '12 Nguyễn Huệ',
      ward: 'Phường Bến Nghé',
      province: 'Hồ Chí Minh',
    };

    const result = await createAddress(input);

    expect(result).toEqual(ADDRESS);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/addresses$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('updateAddress PATCH /addresses/:id, bóc {address}', async () => {
    mockFetchOnce({ success: true, data: { address: { ...ADDRESS, line1: '20 Lê Lợi' } } });

    const result = await updateAddress('address-1', { line1: '20 Lê Lợi' });

    expect(result.line1).toBe('20 Lê Lợi');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/addresses\/address-1$/);
    expect(init.method).toBe('PATCH');
  });

  it('deleteAddress DELETE /addresses/:id', async () => {
    mockFetchOnce({ success: true, data: null });

    await deleteAddress('address-1');

    const [url, init] = lastCall();
    expect(url).toMatch(/\/addresses\/address-1$/);
    expect(init.method).toBe('DELETE');
  });

  it('setDefaultAddress PATCH /addresses/:id/default, bóc {address}', async () => {
    mockFetchOnce({ success: true, data: { address: ADDRESS } });

    const result = await setDefaultAddress('address-1');

    expect(result).toEqual(ADDRESS);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/addresses\/address-1\/default$/);
    expect(init.method).toBe('PATCH');
  });

  it('previewCheckout POST /checkout/preview, gửi đúng body', async () => {
    const previewData = {
      orders: [],
      subtotal: '0',
      shippingTotal: null,
      discountTotal: '0',
      grandTotal: null,
      discount: null,
      needsAddress: true,
      paymentMethods: [],
      excludedItems: [],
      blockingIssues: [],
      canPlaceOrder: false,
    };
    mockFetchOnce({ success: true, data: previewData });

    const result = await previewCheckout({ voucherCode: 'SALE10' });

    expect(result).toEqual(previewData);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/checkout\/preview$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ voucherCode: 'SALE10' });
  });

  it('previewCheckout — response sai shape ném lỗi parse', async () => {
    mockFetchOnce({ success: true, data: { orders: [] } });

    await expect(previewCheckout({})).rejects.toThrow();
  });

  it('placeOrder POST /checkout, không có Idempotency-Key thì không gửi header', async () => {
    mockFetchOnce({ success: true, data: CHECKOUT_RESULT }, 201);
    const input = {
      addressId: 'address-1',
      paymentMethod: 'VNPAY' as const,
      expectedTotal: 320000,
    };

    const result = await placeOrder(input);

    expect(result).toEqual(CHECKOUT_RESULT);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/checkout$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('placeOrder COD — kết quả không có hạn thanh toán và không có payUrl (expiresAt/paymentUrl null) vẫn parse được', async () => {
    const codResult = {
      ...CHECKOUT_RESULT,
      orders: [{ ...CHECKOUT_RESULT.orders[0], status: 'PENDING' }],
      paymentMethod: 'COD',
      expiresAt: null,
      paymentUrl: null,
    };
    mockFetchOnce({ success: true, data: codResult }, 201);

    const result = await placeOrder({
      addressId: 'address-1',
      paymentMethod: 'COD',
      expectedTotal: 320000,
    });

    expect(result).toEqual(codResult);
  });

  it('placeOrder gửi shopNotes (lời nhắn theo shopId) trong body khi có, không gửi khoá khi không có (Week8.md 3B)', async () => {
    mockFetchOnce({ success: true, data: CHECKOUT_RESULT }, 201);
    await placeOrder({
      addressId: 'address-1',
      paymentMethod: 'COD',
      expectedTotal: 320000,
      shopNotes: { 'shop-1': 'Gọi trước khi giao', 'shop-2': 'Gói quà' },
    });
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      addressId: 'address-1',
      paymentMethod: 'COD',
      expectedTotal: 320000,
      shopNotes: { 'shop-1': 'Gọi trước khi giao', 'shop-2': 'Gói quà' },
    });

    mockFetchOnce({ success: true, data: CHECKOUT_RESULT }, 201);
    await placeOrder({
      addressId: 'address-1',
      paymentMethod: 'COD',
      expectedTotal: 320000,
      shopNotes: undefined,
    });
    // JSON.stringify bỏ khoá undefined — BE không nhận `shopNotes: null` hay `{}` thừa.
    expect(JSON.parse(lastCall()[1].body as string)).not.toHaveProperty('shopNotes');
  });

  it('placeOrder gửi header Idempotency-Key khi có truyền', async () => {
    mockFetchOnce({ success: true, data: CHECKOUT_RESULT }, 201);
    const input = {
      addressId: 'address-1',
      paymentMethod: 'VNPAY' as const,
      expectedTotal: 320000,
    };

    await placeOrder(input, '11111111-1111-4111-8111-111111111111');

    const [, init] = lastCall();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('placeOrder hết hàng — ApiError 409 giữ message của BE', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Out of stock' }, 409);

    await expect(
      placeOrder({ addressId: 'address-1', paymentMethod: 'VNPAY', expectedTotal: 1 }),
    ).rejects.toMatchObject({ status: 409, message: 'Out of stock' });
  });

  it('getCheckoutGroup GET /checkout/groups/:groupId', async () => {
    mockFetchOnce({ success: true, data: CHECKOUT_GROUP });

    const result = await getCheckoutGroup('group-1');

    expect(result).toEqual(CHECKOUT_GROUP);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/checkout\/groups\/group-1$/);
    expect(init.method).toBe('GET');
  });

  it('getCheckoutGroup — response sai shape ném lỗi parse', async () => {
    mockFetchOnce({ success: true, data: { id: 'group-1' } });

    await expect(getCheckoutGroup('group-1')).rejects.toThrow();
  });

  it('retryPayment POST /checkout/groups/:groupId/pay, trả {paymentUrl, expiresAt}', async () => {
    const payload = {
      paymentUrl: 'https://sandbox.vnpayment.vn/x',
      expiresAt: '2026-09-27T05:00:00.000Z',
    };
    mockFetchOnce({ success: true, data: payload });

    const result = await retryPayment('group-1');

    expect(result).toEqual(payload);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/checkout\/groups\/group-1\/pay$/);
    expect(init.method).toBe('POST');
  });
});
