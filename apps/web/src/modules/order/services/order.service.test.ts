import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approveRefundRequest,
  cancelOrder,
  cancelSellerOrder,
  confirmOrder,
  confirmReceived,
  escalateRefundRequest,
  getOrder,
  getSellerOrder,
  listOrders,
  listSellerOrders,
  listSellerRefundRequests,
  packOrder,
  rejectOrder,
  rejectRefundRequest,
  requestRefund,
  retryPayment,
  shipOrder,
  withdrawRefundRequest,
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
  canRequestCancel: false,
  canRequestReturn: false,
  refundRequest: null,
  refund: null,
  canConfirmReceived: false,
  canRetryPayment: false,
};

// Dòng hàng ở CHI TIẾT đơn của buyer có thêm định danh sản phẩm + trạng thái đánh giá (Week9.md 2.10);
// danh sách đơn và đơn phía seller vẫn dùng ITEM cơ sở.
const DETAIL_ITEM = {
  ...ITEM,
  productId: 'product-1',
  productSlug: 'ao-thun',
  canReview: false,
  review: null,
};

const BUYER_DETAIL = {
  ...BUYER_LIST_ITEM,
  items: [DETAIL_ITEM],
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
  buyerNote: null,
  history: HISTORY,
};

const SELLER_LIST_ITEM = {
  id: 'order-1',
  status: 'PENDING',
  createdAt: '2026-10-01T00:00:00.000Z',
  totalAmount: '320000',
  recipientName: 'Nguyễn Văn A',
  shippingProvince: 'TP. Hồ Chí Minh',
  buyerNote: null,
  items: [ITEM],
  itemCount: 1,
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  canConfirm: true,
  canPack: false,
  canShip: false,
  canReject: true,
  canCancel: false,
  refundRequest: null,
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

  it('getOrder giữ lời nhắn cho shop (buyerNote) — field phải có trong schema, nếu không z.object sẽ bỏ mất (Week8.md 3B)', async () => {
    mockFetchOnce({ success: true, data: { ...BUYER_DETAIL, buyerNote: 'Gọi trước khi giao' } });

    expect((await getOrder('order-1')).buyerNote).toBe('Gọi trước khi giao');
  });

  it('getOrder — response thiếu buyerNote bị Zod từ chối (BE phải trả null tường minh)', async () => {
    const withoutNote = Object.fromEntries(
      Object.entries(BUYER_DETAIL).filter(([key]) => key !== 'buyerNote'),
    );
    mockFetchOnce({ success: true, data: withoutNote });

    await expect(getOrder('order-1')).rejects.toThrow();
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
        message: 'Order cannot be cancelled: PROCESSING_STARTED',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PROCESSING_STARTED' },
      },
      409,
    );

    await expect(cancelOrder('order-1')).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
      details: { reason: 'PROCESSING_STARTED' },
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

  it('seller: danh sách và chi tiết giữ lời nhắn của người mua (buyerNote), đơn không có là null (Week8.md 3B)', async () => {
    mockFetchOnce({
      success: true,
      data: {
        items: [{ ...SELLER_LIST_ITEM, buyerNote: 'Gói quà' }, SELLER_LIST_ITEM],
        total: 2,
        page: 1,
        limit: 10,
      },
    });
    const list = await listSellerOrders('shop-1');
    expect(list.items.map((o) => o.buyerNote)).toEqual(['Gói quà', null]);

    mockFetchOnce({ success: true, data: { ...SELLER_DETAIL, buyerNote: 'Gói quà' } });
    expect((await getSellerOrder('shop-1', 'order-1')).buyerNote).toBe('Gói quà');
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

  it('rejectOrder — 409 ORDER_CANCEL_NOT_ALLOWED (đơn đã xác nhận) giữ nguyên details', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Order cannot be cancelled: PROCESSING_STARTED',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PROCESSING_STARTED' },
      },
      409,
    );

    await expect(rejectOrder('shop-1', 'order-1', { reason: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
      details: { reason: 'PROCESSING_STARTED' },
    });
  });
});

// Yêu cầu hủy/trả hàng nhìn từ phía người mua (field nào thiếu thì Zod từ chối — xem
// buyerRefundRequestSchema ở packages/types).
const BUYER_REFUND_REQUEST = {
  id: 'request-1',
  kind: 'CANCEL',
  status: 'PENDING_SELLER',
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: null,
  sellerRespondBy: '2026-10-03T00:00:00.000Z',
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  canWithdraw: true,
  canEscalate: false,
};

describe('order.service — yêu cầu hủy/trả hàng (buyer)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requestRefund -> POST /orders/:id/refund-requests, id trên URL còn body chỉ có lý do', async () => {
    mockFetchOnce(
      {
        success: true,
        data: { ...BUYER_DETAIL, status: 'CONFIRMED', refundRequest: BUYER_REFUND_REQUEST },
      },
      201,
    );

    const order = await requestRefund('order-1', {
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: 'Đổi ý',
    });

    expect(order.refundRequest?.status).toBe('PENDING_SELLER');
    expect(order.refundRequest?.canWithdraw).toBe(true);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/orders\/order-1\/refund-requests$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: 'Đổi ý',
    });
  });

  it('requestRefund — ghi chú bỏ trống (undefined) thì không có trong body', async () => {
    mockFetchOnce({ success: true, data: BUYER_DETAIL }, 201);

    await requestRefund('order-1', { reasonCode: 'DAMAGED', reasonNote: undefined });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ reasonCode: 'DAMAGED' });
  });

  it('requestRefund — 409 REFUND_REQUEST_NOT_ALLOWED giữ code + details.reason để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Refund request is not allowed: WINDOW_EXPIRED',
        code: 'REFUND_REQUEST_NOT_ALLOWED',
        details: { reason: 'WINDOW_EXPIRED' },
      },
      409,
    );

    await expect(requestRefund('order-1', { reasonCode: 'DAMAGED' })).rejects.toMatchObject({
      status: 409,
      code: 'REFUND_REQUEST_NOT_ALLOWED',
      details: { reason: 'WINDOW_EXPIRED' },
    });
  });

  it('requestRefund — response thiếu cờ canWithdraw bị Zod từ chối (BE phải tính cờ, FE không tự suy)', async () => {
    const withoutFlag = Object.fromEntries(
      Object.entries(BUYER_REFUND_REQUEST).filter(([key]) => key !== 'canWithdraw'),
    );
    mockFetchOnce({ success: true, data: { ...BUYER_DETAIL, refundRequest: withoutFlag } }, 201);

    await expect(requestRefund('order-1', { reasonCode: 'DAMAGED' })).rejects.toThrow();
  });

  it('withdrawRefundRequest -> POST /refund-requests/:id/withdraw không body, trả chi tiết đơn (refundRequest null)', async () => {
    mockFetchOnce({ success: true, data: { ...BUYER_DETAIL, refundRequest: null } });

    const order = await withdrawRefundRequest('request-1');

    expect(order.refundRequest).toBeNull();
    const [url, init] = lastCall();
    expect(url).toMatch(/\/refund-requests\/request-1\/withdraw$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('withdrawRefundRequest — 409 REFUND_REQUEST_INVALID_TRANSITION (seller vừa trả lời) giữ nguyên code', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Cannot change refund request status from APPROVED to WITHDRAWN',
        code: 'REFUND_REQUEST_INVALID_TRANSITION',
      },
      409,
    );

    await expect(withdrawRefundRequest('request-1')).rejects.toMatchObject({
      status: 409,
      code: 'REFUND_REQUEST_INVALID_TRANSITION',
    });
  });

  it('escalateRefundRequest -> POST /refund-requests/:id/escalate không body, trả chi tiết đơn (ESCALATED)', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...BUYER_DETAIL,
        refundRequest: {
          ...BUYER_REFUND_REQUEST,
          status: 'ESCALATED',
          canWithdraw: false,
          canEscalate: false,
        },
      },
    });

    const order = await escalateRefundRequest('request-1');

    expect(order.refundRequest?.status).toBe('ESCALATED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/refund-requests\/request-1\/escalate$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('escalateRefundRequest — 409 quá hạn khiếu nại giữ code + details.reason = WINDOW_EXPIRED', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Refund request is not allowed: WINDOW_EXPIRED',
        code: 'REFUND_REQUEST_NOT_ALLOWED',
        details: { reason: 'WINDOW_EXPIRED' },
      },
      409,
    );

    await expect(escalateRefundRequest('request-1')).rejects.toMatchObject({
      status: 409,
      code: 'REFUND_REQUEST_NOT_ALLOWED',
      details: { reason: 'WINDOW_EXPIRED' },
    });
  });
});

// Một dòng hàng chờ của seller: yêu cầu đầy đủ + tóm tắt đơn vừa đủ để quyết định.
const SELLER_REFUND_REQUEST_ITEM = {
  id: 'request-1',
  kind: 'CANCEL',
  status: 'PENDING_SELLER',
  sellerRespondBy: '2026-10-03T00:00:00.000Z',
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: null,
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  canApprove: true,
  canReject: true,
  order: {
    id: 'order-1',
    status: 'CONFIRMED',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
    items: [ITEM],
    itemCount: 1,
    paymentMethod: 'VNPAY',
    paymentStatus: 'SUCCESS',
  },
};

describe('order.service — yêu cầu hủy/trả hàng (seller)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancelSellerOrder -> POST /shops/:shopId/orders/:orderId/cancel với lý do bắt buộc', async () => {
    mockFetchOnce({ success: true, data: { ...SELLER_DETAIL, status: 'CANCELLED' } });

    const order = await cancelSellerOrder('shop-1', 'order-1', { reason: 'Hết hàng' });

    expect(order.status).toBe('CANCELLED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/orders\/order-1\/cancel$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Hết hàng' });
  });

  it('cancelSellerOrder — 409 ORDER_CANCEL_NOT_ALLOWED (đã giao cho vận chuyển) giữ nguyên details', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Order cannot be cancelled: IN_TRANSIT',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'IN_TRANSIT' },
      },
      409,
    );

    await expect(cancelSellerOrder('shop-1', 'order-1', { reason: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
      details: { reason: 'IN_TRANSIT' },
    });
  });

  it('listSellerRefundRequests không tham số -> GET /shops/:shopId/refund-requests (không tự gửi default), parse đúng schema', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SELLER_REFUND_REQUEST_ITEM], total: 1, page: 1, limit: 20 },
    });

    const result = await listSellerRefundRequests('shop-1');

    expect(result.items[0].canApprove).toBe(true);
    expect(result.items[0].order.paymentMethod).toBe('VNPAY');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/refund-requests$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('listSellerRefundRequests gửi status/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listSellerRefundRequests('shop-1', { status: 'ESCALATED', page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(
      /\/shops\/shop-1\/refund-requests\?status=ESCALATED&page=2&limit=5$/,
    );

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });
    await listSellerRefundRequests('shop-1', { status: undefined, page: 3 });
    expect(lastCall()[0]).toMatch(/\/shops\/shop-1\/refund-requests\?page=3$/);
  });

  it('listSellerRefundRequests — response thiếu tóm tắt đơn bị Zod từ chối', async () => {
    const withoutOrder = Object.fromEntries(
      Object.entries(SELLER_REFUND_REQUEST_ITEM).filter(([key]) => key !== 'order'),
    );
    mockFetchOnce({
      success: true,
      data: { items: [withoutOrder], total: 1, page: 1, limit: 20 },
    });

    await expect(listSellerRefundRequests('shop-1')).rejects.toThrow();
  });

  it('approveRefundRequest -> POST .../refund-requests/:id/approve, ghi chú tuỳ chọn, trả chính yêu cầu đó', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...SELLER_REFUND_REQUEST_ITEM,
        status: 'APPROVED',
        canApprove: false,
        canReject: false,
      },
    });

    const item = await approveRefundRequest('shop-1', 'request-1', { note: 'Đồng ý hủy' });

    expect(item.status).toBe('APPROVED');
    expect(item.canApprove).toBe(false);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/refund-requests\/request-1\/approve$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Đồng ý hủy' });
  });

  it('approveRefundRequest không ghi chú -> body {} (không để lọt note: undefined)', async () => {
    mockFetchOnce({ success: true, data: SELLER_REFUND_REQUEST_ITEM });

    await approveRefundRequest('shop-1', 'request-1');

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});
  });

  it('approveRefundRequest — 409 REFUND_REQUEST_INVALID_TRANSITION (đã xử lý/người mua vừa rút) giữ nguyên code', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Cannot change refund request status from APPROVED to APPROVED',
        code: 'REFUND_REQUEST_INVALID_TRANSITION',
      },
      409,
    );

    await expect(approveRefundRequest('shop-1', 'request-1')).rejects.toMatchObject({
      status: 409,
      code: 'REFUND_REQUEST_INVALID_TRANSITION',
    });
  });

  it('rejectRefundRequest -> POST .../refund-requests/:id/reject với ghi chú bắt buộc', async () => {
    mockFetchOnce({
      success: true,
      data: { ...SELLER_REFUND_REQUEST_ITEM, status: 'REJECTED_BY_SELLER' },
    });

    const item = await rejectRefundRequest('shop-1', 'request-1', { note: 'Hàng đã gửi đi' });

    expect(item.status).toBe('REJECTED_BY_SELLER');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/refund-requests\/request-1\/reject$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Hàng đã gửi đi' });
  });

  it('rejectRefundRequest — 400 thiếu ghi chú giữ message dạng key i18n để UI dịch', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'note: order.validationReasonRequired' },
      400,
    );

    await expect(rejectRefundRequest('shop-1', 'request-1', { note: '' })).rejects.toMatchObject({
      status: 400,
      message: 'note: order.validationReasonRequired',
    });
  });
});
