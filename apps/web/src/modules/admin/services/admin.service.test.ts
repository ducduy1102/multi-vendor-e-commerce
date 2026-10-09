import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decideRefundRequest,
  listRefundablePayments,
  listRefundRequests,
  listRefunds,
  listShops,
  markRefundCompleted,
  refundPayment,
  retryRefund,
  updateShopStatus,
} from './admin.service';

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

// --- Hoàn tiền (Week9.md 2.9/3.1) ------------------------------------------------------------------

const BUYER = { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' };

const ITEM = {
  productName: 'Áo thun',
  variantLabel: 'Đỏ / M',
  sku: 'AT-D-M',
  imageUrl: null,
  quantity: 2,
  priceAtPurchase: '150000',
};

const REFUND_REQUEST = {
  id: 'request-1',
  kind: 'RETURN',
  status: 'ESCALATED',
  reasonCode: 'DAMAGED',
  reasonNote: 'Rách tay áo',
  sellerRespondBy: '2026-10-03T00:00:00.000Z',
  statusChangedAt: '2026-10-04T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      toStatus: 'ESCALATED',
      actorType: 'SYSTEM',
      note: null,
      createdAt: '2026-10-04T00:00:00.000Z',
    },
  ],
  canApprove: true,
  canReject: true,
  shop: { id: 'shop-1', name: 'Shop A' },
  buyer: BUYER,
  order: {
    id: 'order-1',
    status: 'COMPLETED',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
    items: [ITEM],
    itemCount: 1,
    paymentMethod: 'VNPAY',
    paymentStatus: 'SUCCESS',
    refund: null,
  },
};

const REFUND = {
  id: 'refund-1',
  status: 'FAILED',
  amount: '320000',
  attempts: 3,
  reason: 'Người mua hủy đơn',
  failureReason: 'Gateway rejected the refund',
  gatewayRef: null,
  initiatedByType: 'SYSTEM',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T01:00:00.000Z',
  completedAt: null,
  canRetry: true,
  canMarkCompleted: true,
  payment: {
    id: 'payment-1',
    method: 'VNPAY',
    status: 'SUCCESS',
    amount: '320000',
    refundedAmount: '0',
    txnRef: 'TXN-1',
    transactionId: '14012345',
  },
  order: {
    id: 'order-1',
    status: 'CANCELLED',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
  },
  buyer: BUYER,
};

const REFUNDABLE_PAYMENT = {
  id: 'payment-2',
  kind: 'PAID_AFTER_EXPIRY',
  method: 'VNPAY',
  amount: '320000',
  paidAt: '2026-10-02T00:00:00.000Z',
  txnRef: 'TXN-2',
  transactionId: '14012346',
  checkoutGroupId: 'group-1',
  buyer: BUYER,
  orders: [{ id: 'order-2', status: 'CANCELLED', totalAmount: '320000' }],
};

describe('admin.service — listRefundRequests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('không tham số -> GET /admin/refund-requests (không tự gửi default), parse đúng schema', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [REFUND_REQUEST], total: 1, page: 1, limit: 20 },
    });

    const result = await listRefundRequests();

    expect(result.items[0].buyer.email).toBe('nguyenvana@example.com');
    expect(result.items[0].canApprove).toBe(true);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refund-requests$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('gửi status/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listRefundRequests({ status: 'PENDING_SELLER', page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(
      /\/admin\/refund-requests\?status=PENDING_SELLER&page=2&limit=5$/,
    );

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });
    await listRefundRequests({ status: undefined, page: 3 });
    expect(lastCall()[0]).toMatch(/\/admin\/refund-requests\?page=3$/);
  });

  it('response thiếu thông tin người mua -> Zod từ chối thay vì để UI đọc undefined', async () => {
    const { buyer, ...withoutBuyer } = REFUND_REQUEST;
    void buyer;
    mockFetchOnce({
      success: true,
      data: { items: [withoutBuyer], total: 1, page: 1, limit: 20 },
    });

    await expect(listRefundRequests()).rejects.toThrow();
  });

  it('403 (không phải ADMIN) -> ApiError giữ status để hook không thử lại', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, 403);

    await expect(listRefundRequests()).rejects.toMatchObject({ status: 403 });
  });
});

describe('admin.service — decideRefundRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /admin/refund-requests/:id/decide, id trên URL còn body chỉ có decision + note, trả chính yêu cầu đó', async () => {
    mockFetchOnce({
      success: true,
      data: { ...REFUND_REQUEST, status: 'APPROVED', canApprove: false, canReject: false },
    });

    const item = await decideRefundRequest('request-1', {
      decision: 'APPROVE',
      note: 'Ảnh hợp lệ',
    });

    expect(item.status).toBe('APPROVED');
    expect(item.canApprove).toBe(false);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refund-requests\/request-1\/decide$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'APPROVE', note: 'Ảnh hợp lệ' });
  });

  it('duyệt không ghi chú -> body chỉ có decision', async () => {
    mockFetchOnce({ success: true, data: REFUND_REQUEST });

    await decideRefundRequest('request-1', { decision: 'APPROVE', note: undefined });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ decision: 'APPROVE' });
  });

  it('409 REFUND_REQUEST_INVALID_TRANSITION (seller/Admin khác vừa xử lý) giữ code để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Cannot change refund request status from APPROVED to REJECTED',
        code: 'REFUND_REQUEST_INVALID_TRANSITION',
      },
      409,
    );

    await expect(
      decideRefundRequest('request-1', { decision: 'REJECT', note: 'Không hợp lệ' }),
    ).rejects.toMatchObject({ status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' });
  });

  it('400 từ chối thiếu ghi chú (BE kiểm) -> ApiError giữ message dạng key i18n', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'note: order.validationReasonRequired' },
      400,
    );

    await expect(
      decideRefundRequest('request-1', { decision: 'REJECT', note: undefined }),
    ).rejects.toMatchObject({ status: 400, message: 'note: order.validationReasonRequired' });
  });
});

describe('admin.service — listRefunds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('không tham số -> GET /admin/refunds, parse khoản hoàn kèm cờ canRetry/canMarkCompleted do BE tính', async () => {
    mockFetchOnce({ success: true, data: { items: [REFUND], total: 1, page: 1, limit: 20 } });

    const result = await listRefunds();

    expect(result.items[0].canRetry).toBe(true);
    expect(result.items[0].payment.txnRef).toBe('TXN-1');
    expect(result.items[0].order?.id).toBe('order-1');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refunds$/);
    expect(init.method).toBe('GET');
  });

  it('khoản hoàn của thanh toán bất thường không gắn đơn (order: null) vẫn parse được', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [{ ...REFUND, order: null }], total: 1, page: 1, limit: 20 },
    });

    expect((await listRefunds()).items[0].order).toBeNull();
  });

  it('gửi bộ lọc status lên query string', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });

    await listRefunds({ status: 'SUCCEEDED', page: 2 });

    expect(lastCall()[0]).toMatch(/\/admin\/refunds\?status=SUCCEEDED&page=2$/);
  });

  it('response thiếu cờ canRetry bị Zod từ chối (BE phải tính cờ, FE không tự suy)', async () => {
    const { canRetry, ...withoutFlag } = REFUND;
    void canRetry;
    mockFetchOnce({
      success: true,
      data: { items: [withoutFlag], total: 1, page: 1, limit: 20 },
    });

    await expect(listRefunds()).rejects.toThrow();
  });
});

describe('admin.service — retryRefund / markRefundCompleted', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retryRefund -> POST /admin/refunds/:id/retry không body, trả khoản hoàn mới nhất', async () => {
    mockFetchOnce({
      success: true,
      data: { ...REFUND, status: 'SUCCEEDED', canRetry: false, canMarkCompleted: false },
    });

    const refund = await retryRefund('refund-1');

    expect(refund.status).toBe('SUCCEEDED');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refunds\/refund-1\/retry$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('retryRefund — cổng vẫn từ chối thì vẫn là 200 với status FAILED (không phải lỗi HTTP)', async () => {
    mockFetchOnce({ success: true, data: REFUND });

    expect((await retryRefund('refund-1')).status).toBe('FAILED');
  });

  it('retryRefund — 409 PAYMENT_REFUND_NOT_RETRYABLE giữ code để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Refund is not in a state that can be retried or completed manually',
        code: 'PAYMENT_REFUND_NOT_RETRYABLE',
      },
      409,
    );

    await expect(retryRefund('refund-1')).rejects.toMatchObject({
      status: 409,
      code: 'PAYMENT_REFUND_NOT_RETRYABLE',
    });
  });

  it('markRefundCompleted -> POST /admin/refunds/:id/mark-completed với mã tham chiếu', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...REFUND,
        status: 'SUCCEEDED',
        gatewayRef: 'MANUAL:VNP-998',
        completedAt: '2026-10-05T00:00:00.000Z',
        canRetry: false,
        canMarkCompleted: false,
      },
    });

    const refund = await markRefundCompleted('refund-1', { reference: 'VNP-998' });

    expect(refund.gatewayRef).toBe('MANUAL:VNP-998');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refunds\/refund-1\/mark-completed$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reference: 'VNP-998' });
  });

  it('markRefundCompleted — 400 thiếu mã tham chiếu giữ message dạng key i18n', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'reference: admin.validationRefundReferenceRequired' },
      400,
    );

    await expect(markRefundCompleted('refund-1', { reference: '' })).rejects.toMatchObject({
      status: 400,
      message: 'reference: admin.validationRefundReferenceRequired',
    });
  });
});

describe('admin.service — listRefundablePayments / refundPayment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listRefundablePayments -> GET /admin/refundable-payments, parse thanh toán bất thường kèm các đơn của nhóm', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [REFUNDABLE_PAYMENT], total: 1, page: 1, limit: 20 },
    });

    const result = await listRefundablePayments();

    expect(result.items[0].kind).toBe('PAID_AFTER_EXPIRY');
    expect(result.items[0].orders).toHaveLength(1);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/refundable-payments$/);
    expect(init.method).toBe('GET');
  });

  it('listRefundablePayments chỉ có page/limit (không có bộ lọc status)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listRefundablePayments({ page: 2, limit: 5 });

    expect(lastCall()[0]).toMatch(/\/admin\/refundable-payments\?page=2&limit=5$/);
  });

  it('listRefundablePayments — loại bất thường lạ bị Zod từ chối', async () => {
    mockFetchOnce({
      success: true,
      data: {
        items: [{ ...REFUNDABLE_PAYMENT, kind: 'SOMETHING_ELSE' }],
        total: 1,
        page: 1,
        limit: 20,
      },
    });

    await expect(listRefundablePayments()).rejects.toThrow();
  });

  it('refundPayment -> POST /admin/payments/:id/refund với lý do tuỳ chọn, trả khoản hoàn vừa tạo', async () => {
    mockFetchOnce({ success: true, data: { ...REFUND, order: null, status: 'SUCCEEDED' } });

    const refund = await refundPayment('payment-2', { reason: 'Khách trả hai lần' });

    expect(refund.order).toBeNull();
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/payments\/payment-2\/refund$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Khách trả hai lần' });
  });

  it('refundPayment không lý do -> body {}', async () => {
    mockFetchOnce({ success: true, data: REFUND });

    await refundPayment('payment-2');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: REFUND });
    await refundPayment('payment-2', { reason: undefined });
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});
  });

  it('refundPayment — 409 PAYMENT_NOT_REFUNDABLE (không còn bất thường) giữ code để FE dịch', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Only a late or duplicate payment can be refunded without an order',
        code: 'PAYMENT_NOT_REFUNDABLE',
      },
      409,
    );

    await expect(refundPayment('payment-2')).rejects.toMatchObject({
      status: 409,
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
  });
});
