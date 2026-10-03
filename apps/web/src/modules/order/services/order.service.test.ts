import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelOrder,
  confirmOrder,
  confirmReceived,
  getOrder,
  getSellerOrder,
  listOrders,
  listSellerOrders,
  packOrder,
  rejectOrder,
  retryPayment,
  shipOrder,
} from './order.service';

const ITEM = {
  productName: 'Áo thun',
  variantLabel: 'Đỏ / M',
  sku: 'AT-D-M',
  imageUrl: null,
  quantity: 2,
  priceAtPurchase: '150000',
};

const HISTORY = [
  {
    fromStatus: null,
    toStatus: 'PENDING',
    actorType: 'BUYER',
    note: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
];

const BUYER_LIST_ITEM = {
  id: 'order-1',
  checkoutGroupId: 'group-1',
  status: 'PENDING',
  createdAt: '2026-10-01T00:00:00.000Z',
  totalAmount: '320000',
  shop: { id: 'shop-1', name: 'Shop A', slug: 'shop-a', logoUrl: null },
  items: [ITEM],
  itemCount: 1,
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  canCancel: true,
  canConfirmReceived: false,
  canRetryPayment: false,
};

const BUYER_DETAIL = {
  ...BUYER_LIST_ITEM,
  recipientName: 'Nguyễn Văn A',
  recipientPhone: '0901234567',
  shippingAddressLine: '1 Lê Lợi',
  shippingWard: 'Bến Nghé',
  shippingProvince: 'TP. Hồ Chí Minh',
  subtotal: '300000',
  discountAmount: '0',
  shippingFee: '20000',
  carrier: null,
  trackingCode: null,
  history: HISTORY,
};

const SELLER_LIST_ITEM = {
  id: 'order-1',
  status: 'PENDING',
  createdAt: '2026-10-01T00:00:00.000Z',
  totalAmount: '320000',
  recipientName: 'Nguyễn Văn A',
  shippingProvince: 'TP. Hồ Chí Minh',
  items: [ITEM],
  itemCount: 1,
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  canConfirm: true,
  canPack: false,
  canShip: false,
  canReject: true,
};

const SELLER_DETAIL = {
  ...SELLER_LIST_ITEM,
  recipientPhone: '0901234567',
  shippingAddressLine: '1 Lê Lợi',
  shippingWard: 'Bến Nghé',
  subtotal: '300000',
  discountAmount: '0',
  shippingFee: '20000',
  carrier: null,
  trackingCode: null,
  history: HISTORY,
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

describe('order.service — buyer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listOrders không tham số -> GET /orders (không tự gửi default), parse đúng schema', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [BUYER_LIST_ITEM], total: 1, page: 1, limit: 10 },
    });

    const result = await listOrders();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].canCancel).toBe(true);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/orders$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('listOrders gửi tab/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listOrders({ tab: 'awaiting-payment', page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(/\/orders\?tab=awaiting-payment&page=2&limit=5$/);

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 10 } });
    await listOrders({ tab: undefined, page: 3 });
    expect(lastCall()[0]).toMatch(/\/orders\?page=3$/);
  });

  it('listOrders — response sai hình dạng bị Zod từ chối (không để dữ liệu lạ lọt vào UI)', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [{ ...BUYER_LIST_ITEM, status: 'UNKNOWN' }], total: 1, page: 1, limit: 10 },
    });

    await expect(listOrders()).rejects.toThrow();
  });

  it('getOrder GET /orders/:id, parse chi tiết kèm timeline', async () => {
    mockFetchOnce({ success: true, data: BUYER_DETAIL });

    const order = await getOrder('order-1');

    expect(order.history).toHaveLength(1);
    expect(order.history[0].fromStatus).toBeNull();
    expect(order.shippingProvince).toBe('TP. Hồ Chí Minh');
    expect(lastCall()[0]).toMatch(/\/orders\/order-1$/);
  });

  it('getOrder — 404 giữ nguyên code ORDER_NOT_FOUND của BE (đơn người khác cũng 404)', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'Order not found', code: 'ORDER_NOT_FOUND' },
      404,
    );

    await expect(getOrder('order-x')).rejects.toMatchObject({
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });

  it('cancelOrder POST /orders/:id/cancel kèm lý do', async () => {
    mockFetchOnce({ success: true, data: { ...BUYER_DETAIL, status: 'CANCELLED' } });

    const order = await cancelOrder('order-1', { reason: 'Đặt nhầm' });

    expect(order.status).toBe('CANCELLED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/orders\/order-1\/cancel$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Đặt nhầm' });
  });

  it('cancelOrder không có lý do -> gửi body rỗng {} (lý do tuỳ chọn)', async () => {
    mockFetchOnce({ success: true, data: BUYER_DETAIL });

    await cancelOrder('order-1');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: BUYER_DETAIL });
    await cancelOrder('order-1', { reason: undefined });
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});
  });

  it('cancelOrder — 409 ORDER_CANCEL_NOT_ALLOWED giữ code + details để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Paid orders cannot be cancelled yet',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PAID_ONLINE' },
      },
      409,
    );

    await expect(cancelOrder('order-1')).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
      details: { reason: 'PAID_ONLINE' },
    });
  });

  it('confirmReceived POST /orders/:id/confirm-received không body', async () => {
    mockFetchOnce({ success: true, data: { ...BUYER_DETAIL, status: 'COMPLETED' } });

    const order = await confirmReceived('order-1');

    expect(order.status).toBe('COMPLETED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/orders\/order-1\/confirm-received$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});

describe('order.service — thanh toán lại', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retryPayment POST /checkout/groups/:groupId/pay không body, parse URL thanh toán', async () => {
    mockFetchOnce({
      success: true,
      data: { paymentUrl: 'https://pay.example/x', expiresAt: '2026-10-03T10:00:00.000Z' },
    });

    const result = await retryPayment('group-1');

    expect(result.paymentUrl).toBe('https://pay.example/x');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/checkout\/groups\/group-1\/pay$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('retryPayment — 409 PAYMENT_RETRY_NOT_ALLOWED giữ code + details để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Payment cannot be retried',
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'NOT_ONLINE_PAYMENT' },
      },
      409,
    );

    await expect(retryPayment('group-1')).rejects.toMatchObject({
      status: 409,
      code: 'PAYMENT_RETRY_NOT_ALLOWED',
      details: { reason: 'NOT_ONLINE_PAYMENT' },
    });
  });

  it('retryPayment — response thiếu paymentUrl bị Zod từ chối (không redirect tới URL rỗng)', async () => {
    mockFetchOnce({ success: true, data: { expiresAt: '2026-10-03T10:00:00.000Z' } });

    await expect(retryPayment('group-1')).rejects.toThrow();
  });
});

describe('order.service — seller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listSellerOrders GET /shops/:shopId/orders kèm tab/page, parse danh sách', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SELLER_LIST_ITEM], total: 1, page: 1, limit: 10 },
    });

    const result = await listSellerOrders('shop-1', { tab: 'pending', page: 1 });

    expect(result.items[0].canConfirm).toBe(true);
    expect(lastCall()[0]).toMatch(/\/shops\/shop-1\/orders\?tab=pending&page=1$/);
  });

  it('listSellerOrders không tham số -> không có query string', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 10 } });

    await listSellerOrders('shop-1');

    expect(lastCall()[0]).toMatch(/\/shops\/shop-1\/orders$/);
  });

  it('listSellerOrders — response lộ field buyer thì bị strip, không có email/userId trong kết quả', async () => {
    mockFetchOnce({
      success: true,
      data: {
        items: [{ ...SELLER_LIST_ITEM, userId: 'u1', buyerEmail: 'a@b.c' }],
        total: 1,
        page: 1,
        limit: 10,
      },
    });

    const result = await listSellerOrders('shop-1');

    expect(result.items[0]).not.toHaveProperty('userId');
    expect(result.items[0]).not.toHaveProperty('buyerEmail');
  });

  it('getSellerOrder GET /shops/:shopId/orders/:orderId', async () => {
    mockFetchOnce({ success: true, data: SELLER_DETAIL });

    const order = await getSellerOrder('shop-1', 'order-1');

    expect(order.recipientPhone).toBe('0901234567');
    expect(lastCall()[0]).toMatch(/\/shops\/shop-1\/orders\/order-1$/);
  });

  it('getSellerOrder — 404 (đơn shop khác/đơn chưa thanh toán/không tồn tại) là ApiError 404', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'Order not found', code: 'ORDER_NOT_FOUND' },
      404,
    );

    await expect(getSellerOrder('shop-1', 'order-x')).rejects.toMatchObject({
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });

  it.each([
    ['confirm', confirmOrder, 'CONFIRMED'],
    ['pack', packOrder, 'PACKED'],
  ] as const)(
    '%s POST /shops/:shopId/orders/:orderId/%s không body',
    async (action, fn, status) => {
      mockFetchOnce({ success: true, data: { ...SELLER_DETAIL, status } });

      const order = await fn('shop-1', 'order-1');

      expect(order.status).toBe(status);
      const [url, init] = lastCall();
      expect(url).toMatch(new RegExp(`/shops/shop-1/orders/order-1/${action}$`));
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
    },
  );

  it('shipOrder gửi carrier/trackingCode, nhận lại đơn có mã vận đơn', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...SELLER_DETAIL,
        status: 'SHIPPING',
        carrier: 'Giao Hàng Nhanh',
        trackingCode: 'GHN123',
      },
    });

    const order = await shipOrder('shop-1', 'order-1', {
      carrier: 'Giao Hàng Nhanh',
      trackingCode: 'GHN123',
    });

    expect(order.trackingCode).toBe('GHN123');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/orders\/order-1\/ship$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      carrier: 'Giao Hàng Nhanh',
      trackingCode: 'GHN123',
    });
  });

  it('shipOrder không nhập gì (shop tự giao) -> body rỗng {}', async () => {
    mockFetchOnce({ success: true, data: { ...SELLER_DETAIL, status: 'SHIPPING' } });

    await shipOrder('shop-1', 'order-1');

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});
  });

  it('rejectOrder gửi lý do bắt buộc', async () => {
    mockFetchOnce({ success: true, data: { ...SELLER_DETAIL, status: 'CANCELLED' } });

    const order = await rejectOrder('shop-1', 'order-1', { reason: 'Hết hàng' });

    expect(order.status).toBe('CANCELLED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/orders\/order-1\/reject$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Hết hàng' });
  });

  it('rejectOrder — 409 ORDER_CANCEL_NOT_ALLOWED (đơn đã trả online) giữ nguyên details', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Paid orders cannot be rejected yet',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PAID_ONLINE' },
      },
      409,
    );

    await expect(rejectOrder('shop-1', 'order-1', { reason: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
      details: { reason: 'PAID_ONLINE' },
    });
  });
});
