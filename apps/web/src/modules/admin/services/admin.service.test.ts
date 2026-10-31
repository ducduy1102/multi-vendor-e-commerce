import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAppeal } from '../admin-appeal.fixtures';
import { makeResolvedReport, makeReportPage, makeReviewReport } from '../admin-report.fixtures';
import {
  cancelShopOpenOrders,
  createAdminNote,
  decideAppeal,
  decideRefundRequest,
  getOverview,
  getReport,
  getUser,
  listAdminNotes,
  listAppeals,
  listRefundablePayments,
  listRefundRequests,
  listRefunds,
  listReports,
  listShops,
  listUsers,
  markRefundCompleted,
  refundPayment,
  reactivateUser,
  resolveReport,
  retryRefund,
  suspendUser,
  unhideReview,
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

describe('admin.service — getOverview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const OVERVIEW = {
    pendingShops: 3,
    escalatedRefundRequests: 1,
    refundsNeedingAction: 0,
    refundablePayments: 12,
    openReports: 4,
  };

  it('GET /admin/overview (không query, không body), trả đúng 5 số', async () => {
    mockFetchOnce({ success: true, data: OVERVIEW });

    const result = await getOverview();

    expect(result).toEqual(OVERVIEW);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/overview$/);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it.each([
    ['thiếu một số', { pendingShops: 1 }],
    ['số âm', { ...OVERVIEW, pendingShops: -1 }],
    ['số thập phân', { ...OVERVIEW, refundablePayments: 1.5 }],
    ['số dạng chuỗi', { ...OVERVIEW, refundablePayments: '3' }],
  ])('response sai hình dạng (%s) -> ném lỗi, không trả số sai cho UI', async (_name, body) => {
    mockFetchOnce({ success: true, data: body });

    await expect(getOverview()).rejects.toThrow();
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập / không phải ADMIN) -> giữ nguyên status để UI xử lý',
    async (status) => {
      mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, status);

      await expect(getOverview()).rejects.toMatchObject({ status });
    },
  );
});

const USER = {
  id: '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f',
  email: 'an@example.com',
  name: 'Nguyễn Văn An',
  role: 'USER',
  accountStatus: 'ACTIVE',
  statusReason: null,
  statusChangedAt: null,
  isEmailVerified: true,
  createdAt: '2026-03-02T08:00:00.000Z',
};

describe('admin.service — người dùng', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listUsers: không tham số -> GET /admin/users trơn, kèm cookie, parse đúng schema', async () => {
    mockFetchOnce({ success: true, data: { items: [USER], total: 1, page: 1, limit: 20 } });

    const result = await listUsers();

    expect(result.items[0].email).toBe('an@example.com');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/users$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('listUsers: gửi status/role/q/page/limit, bỏ field undefined và từ khoá rỗng, mã hoá từ khoá', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listUsers({ status: 'BANNED', role: 'USER', q: 'Nguyễn & Co', page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(
      /\/admin\/users\?status=BANNED&role=USER&q=Nguy%E1%BB%85n\+%26\+Co&page=2&limit=5$/,
    );

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } });
    await listUsers({ status: undefined, q: '', page: 3 });
    expect(lastCall()[0]).toMatch(/\/admin\/users\?page=3$/);
  });

  it('listUsers: response lộ trường nhạy cảm bị Zod loại bỏ (allowlist), response sai hình dạng bị từ chối', async () => {
    mockFetchOnce({
      success: true,
      data: {
        items: [{ ...USER, passwordHash: 'secret', refreshTokenHash: 'secret' }],
        total: 1,
        page: 1,
        limit: 20,
      },
    });
    const result = await listUsers();
    expect(result.items[0]).not.toHaveProperty('passwordHash');
    expect(result.items[0]).not.toHaveProperty('refreshTokenHash');

    vi.unstubAllGlobals();
    const { email, ...withoutEmail } = USER;
    void email;
    mockFetchOnce({ success: true, data: { items: [withoutEmail], total: 1, page: 1, limit: 20 } });
    await expect(listUsers()).rejects.toThrow();
  });

  it('listUsers: 403 (không phải ADMIN) -> ApiError giữ status để hook không thử lại', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, 403);

    await expect(listUsers()).rejects.toMatchObject({ status: 403 });
  });

  it('getUser: GET /admin/users/:id, BE trả thẳng đối tượng chi tiết', async () => {
    mockFetchOnce({
      success: true,
      data: { ...USER, locale: 'vi', orderCount: 3, shops: [], history: [] },
    });

    const detail = await getUser(USER.id);

    expect(detail.orderCount).toBe(3);
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/admin/users/${USER.id}$`));
    expect(init.method).toBe('GET');
  });

  it('getUser: 404 -> ApiError mang status và mã USER_NOT_FOUND', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            success: false,
            data: null,
            message: 'User not found',
            code: 'USER_NOT_FOUND',
          }),
      }),
    );

    await expect(getUser(USER.id)).rejects.toMatchObject({ status: 404 });
  });

  it('suspendUser: POST /admin/users/:id/suspend với {status, reason}, lấy người dùng trong { user }', async () => {
    mockFetchOnce({
      success: true,
      data: { user: { ...USER, accountStatus: 'BANNED', statusReason: 'Lừa đảo' } },
    });

    const user = await suspendUser(USER.id, { status: 'BANNED', reason: 'Lừa đảo' });

    expect(user.accountStatus).toBe('BANNED');
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/admin/users/${USER.id}/suspend$`));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'BANNED', reason: 'Lừa đảo' });
  });

  it('reactivateUser: POST /admin/users/:id/reactivate chỉ với {reason}', async () => {
    mockFetchOnce({ success: true, data: { user: USER } });

    const user = await reactivateUser(USER.id, { reason: 'Đã xét lại' });

    expect(user.accountStatus).toBe('ACTIVE');
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/admin/users/${USER.id}/reactivate$`));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Đã xét lại' });
  });

  it.each([
    [409, 'USER_INVALID_TRANSITION'],
    [409, 'CANNOT_MODIFY_ADMIN'],
    [409, 'CANNOT_MODIFY_SELF'],
    [404, 'USER_NOT_FOUND'],
  ])(
    'suspendUser: %i %s -> ApiError mang status và mã lỗi để giao diện dịch',
    async (status, code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: () => Promise.resolve({ success: false, data: null, message: 'x', code }),
        }),
      );

      await expect(
        suspendUser(USER.id, { status: 'SUSPENDED', reason: 'x' }),
      ).rejects.toMatchObject({
        status,
        code,
      });
    },
  );
});

describe('admin.service — cancelShopOpenOrders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const RESULT = {
    cancelled: 18,
    failed: [{ orderId: 'o-1', code: 'ORDER_INVALID_TRANSITION' }],
    needsManualRefund: [{ orderId: 'o-2', refundId: 'r-1', amount: '220000' }],
    refundsPending: 1,
    remaining: 3,
  };

  it('POST /admin/shops/:id/cancel-open-orders với body { reason }, kèm cookie, parse đúng kết quả', async () => {
    mockFetchOnce({ success: true, data: RESULT });

    const result = await cancelShopOpenOrders('shop-1', { reason: 'Shop bị khoá' });

    expect(result).toEqual(RESULT);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/shops\/shop-1\/cancel-open-orders$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Shop bị khoá' });
  });

  it('response sai hình dạng (thiếu remaining, hoặc số âm) -> Zod từ chối thay vì để UI đọc undefined', async () => {
    const { remaining, ...withoutRemaining } = RESULT;
    void remaining;
    mockFetchOnce({ success: true, data: withoutRemaining });
    await expect(cancelShopOpenOrders('shop-1', { reason: 'x' })).rejects.toThrow();

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: { ...RESULT, cancelled: -1 } });
    await expect(cancelShopOpenOrders('shop-1', { reason: 'x' })).rejects.toThrow();
  });

  it.each([
    [404, undefined],
    [409, 'SHOP_NOT_SUSPENDED'],
    [403, undefined],
  ])('%i %s -> ApiError mang status và mã lỗi để giao diện dịch', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ success: false, data: null, message: 'x', code }),
      }),
    );

    await expect(cancelShopOpenOrders('shop-1', { reason: 'x' })).rejects.toMatchObject({
      status,
      code,
    });
  });
});

describe('admin.service — ghi chú nội bộ (Week11.md 4.3)', () => {
  const TARGET_ID = '11111111-1111-4111-8111-111111111111';
  const NOTE = {
    id: 'note-1',
    targetType: 'SHOP',
    targetId: TARGET_ID,
    content: 'Chủ shop đã gọi lại',
    authorId: 'admin-1',
    authorName: 'Quản trị viên',
    createdAt: '2026-10-28T10:00:00.000Z',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listAdminNotes: GET /admin/notes với targetType + targetId, kèm cookie, parse đúng schema', async () => {
    mockFetchOnce({ success: true, data: { items: [NOTE], total: 1, page: 1, limit: 20 } });

    const result = await listAdminNotes({ targetType: 'SHOP', targetId: TARGET_ID });

    const [url, init] = lastCall();
    expect(url).toContain(`/admin/notes?targetType=SHOP&targetId=${TARGET_ID}`);
    expect(url).not.toContain('page=');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(result.items[0]).toEqual(NOTE);
  });

  it('listAdminNotes: page và limit chỉ gửi khi được truyền (BE tự áp mặc định)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 20 } });

    await listAdminNotes({ targetType: 'USER', targetId: TARGET_ID, page: 2, limit: 20 });

    expect(lastCall()[0]).toContain('targetType=USER');
    expect(lastCall()[0]).toContain('page=2');
    expect(lastCall()[0]).toContain('limit=20');
  });

  it('listAdminNotes: 404 -> ApiError mang status và mã ADMIN_NOTE_TARGET_NOT_FOUND', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Note target not found',
        code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
      },
      404,
    );

    await expect(listAdminNotes({ targetType: 'SHOP', targetId: TARGET_ID })).rejects.toMatchObject(
      { status: 404, code: 'ADMIN_NOTE_TARGET_NOT_FOUND' },
    );
  });

  it('listAdminNotes: response thiếu trường (không có authorId) -> Zod từ chối thay vì để UI đọc undefined', async () => {
    const broken = { ...NOTE, authorId: undefined };
    mockFetchOnce({ success: true, data: { items: [broken], total: 1, page: 1, limit: 20 } });

    await expect(listAdminNotes({ targetType: 'SHOP', targetId: TARGET_ID })).rejects.toThrow();
  });

  it('createAdminNote: POST /admin/notes với đúng ba trường, lấy ghi chú trong { note }', async () => {
    mockFetchOnce({ success: true, data: { note: NOTE } }, 201);

    const result = await createAdminNote({
      targetType: 'SHOP',
      targetId: TARGET_ID,
      content: 'Chủ shop đã gọi lại',
    });

    const [url, init] = lastCall();
    expect(url).toContain('/admin/notes');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(init.body as string)).toEqual({
      targetType: 'SHOP',
      targetId: TARGET_ID,
      content: 'Chủ shop đã gọi lại',
    });
    expect(result).toEqual(NOTE);
  });

  it('createAdminNote: 400 -> ApiError giữ status (form hiện lỗi, không treo)', async () => {
    mockFetchOnce(
      { success: false, data: null, message: 'content: admin.validationNoteRequired' },
      400,
    );

    await expect(
      createAdminNote({ targetType: 'USER', targetId: TARGET_ID, content: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('admin.service — listAppeals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('không tham số -> GET /admin/appeals (không tự gửi default), kèm cookie, parse đúng schema', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [makeAppeal()], total: 1, page: 1, limit: 20 },
    });

    const result = await listAppeals();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].owner.email).toBe('nguyenvana@example.com');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/appeals$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('gửi status/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listAppeals({ status: 'CLOSED', page: 2, limit: 5 });

    expect(lastCall()[0]).toMatch(/\/admin\/appeals\?status=CLOSED&page=2&limit=5$/);
  });

  it('field thừa của BE (vd id người kháng nghị) bị bỏ khi parse', async () => {
    mockFetchOnce({
      success: true,
      data: {
        items: [{ ...makeAppeal(), appellantId: 'user-1', decidedById: 'admin-1' }],
        total: 1,
        page: 1,
        limit: 20,
      },
    });

    const result = await listAppeals();

    expect(JSON.stringify(result)).not.toMatch(/appellantId|decidedById|user-1|admin-1/);
  });

  it('403 (không phải ADMIN) -> ném ApiError mang status', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, 403);

    await expect(listAppeals()).rejects.toMatchObject({ status: 403 });
  });
});

describe('admin.service — decideAppeal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /admin/appeals/:id/decide với đúng body, trả kháng nghị sau khi quyết định (BE bọc trong { appeal })', async () => {
    const decided = makeAppeal({
      state: 'REJECTED',
      decisionNote: 'Chưa đủ giấy tờ',
      decidedByName: 'Quản trị viên',
      decidedAt: '2026-10-29T09:00:00.000Z',
    });
    mockFetchOnce({ success: true, data: { appeal: decided } });

    const result = await decideAppeal('appeal-1', { decision: 'REJECT', note: 'Chưa đủ giấy tờ' });

    expect(result).toMatchObject({ state: 'REJECTED', decisionNote: 'Chưa đủ giấy tờ' });
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/appeals\/appeal-1\/decide$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      decision: 'REJECT',
      note: 'Chưa đủ giấy tờ',
    });
  });

  it('chấp nhận không ghi chú: body không có field note', async () => {
    mockFetchOnce({ success: true, data: { appeal: makeAppeal({ state: 'ACCEPTED' }) } });

    await decideAppeal('appeal-1', { decision: 'ACCEPT' });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ decision: 'ACCEPT' });
  });

  it('id đưa vào đường dẫn được mã hoá (không thể chèn đoạn đường dẫn khác)', async () => {
    mockFetchOnce({ success: true, data: { appeal: makeAppeal() } });

    await decideAppeal('a/../b?x=1', { decision: 'ACCEPT' });

    expect(lastCall()[0]).toMatch(/\/admin\/appeals\/a%2F\.\.%2Fb%3Fx%3D1\/decide$/);
  });

  it.each([
    [409, 'APPEAL_ALREADY_DECIDED'],
    [409, 'APPEAL_TARGET_CHANGED'],
    [409, 'SHOP_OWNER_NOT_ACTIVE'],
    [404, 'APPEAL_NOT_FOUND'],
  ])('%i %s -> ném ApiError mang đúng status và mã lỗi nghiệp vụ', async (status, code) => {
    mockFetchOnce({ success: false, data: null, message: code, code }, status);

    await expect(decideAppeal('appeal-1', { decision: 'ACCEPT' })).rejects.toMatchObject({
      status,
      code,
    });
  });
});

// --- Báo cáo vi phạm (Week11.md 5.6) ---------------------------------------------------------------------

describe('admin.service — báo cáo vi phạm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const REPORT = makeReviewReport({ sameTargetOpenCount: 2 });

  it('listReports: GET /admin/reports; tham số trống KHÔNG gửi lên URL (BE tự áp mặc định)', async () => {
    mockFetchOnce({ success: true, data: makeReportPage([REPORT]) });

    const result = await listReports();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sameTargetOpenCount).toBe(2);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/reports$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('listReports: gửi status, targetType, page, limit lên query string', async () => {
    mockFetchOnce({ success: true, data: makeReportPage([]) });

    await listReports({ status: 'CLOSED', targetType: 'SHOP', page: 2, limit: 10 });

    expect(lastCall()[0]).toMatch(
      /\/admin\/reports\?status=CLOSED&targetType=SHOP&page=2&limit=10$/,
    );
  });

  it('listReports: field thừa của BE bị bỏ khi parse; phản hồi sai hình dạng ⇒ ném lỗi', async () => {
    mockFetchOnce({
      success: true,
      data: makeReportPage([{ ...REPORT, internalNote: 'RIENG-TU' } as never]),
    });
    const result = await listReports();
    expect(JSON.stringify(result)).not.toContain('RIENG-TU');

    mockFetchOnce({ success: true, data: { items: [{ id: 1 }], total: 1, page: 1, limit: 20 } });
    await expect(listReports()).rejects.toThrow();
  });

  it('getReport: GET /admin/reports/:id, bóc `{ report }`, id được mã hoá trong đường dẫn', async () => {
    mockFetchOnce({ success: true, data: { report: REPORT } });

    const report = await getReport('a/b?x=1');

    expect(report.id).toBe(REPORT.id);
    expect(lastCall()[0]).toMatch(/\/admin\/reports\/a%2Fb%3Fx%3D1$/);
  });

  it('resolveReport: POST /admin/reports/:id/resolve với body { action, note }, trả báo cáo SAU khi xử lý', async () => {
    const resolved = makeResolvedReport();
    mockFetchOnce({ success: true, data: { report: resolved } });

    const report = await resolveReport(REPORT.id, {
      action: 'HIDE_REVIEW',
      note: 'Ngôn từ xúc phạm',
    });

    expect(report.status).toBe('RESOLVED');
    const [url, init] = lastCall();
    expect(url).toMatch(new RegExp(`/admin/reports/${REPORT.id}/resolve$`));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'HIDE_REVIEW',
      note: 'Ngôn từ xúc phạm',
    });
  });

  it('unhideReview: POST /admin/reviews/:id/unhide với body { reason }, trả { review }', async () => {
    mockFetchOnce({
      success: true,
      data: { review: { id: 'rv-1', isHidden: false, hiddenAt: null } },
    });

    const result = await unhideReview('rv-1', { reason: 'Đã xét lại, không vi phạm' });

    expect(result.review).toEqual({ id: 'rv-1', isHidden: false, hiddenAt: null });
    const [url, init] = lastCall();
    expect(url).toMatch(/\/admin\/reviews\/rv-1\/unhide$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Đã xét lại, không vi phạm' });
  });

  it('lỗi nghiệp vụ giữ nguyên mã để hook dịch (409 REPORT_ALREADY_CLOSED)', async () => {
    mockFetchOnce(
      { success: false, message: 'Report already closed', code: 'REPORT_ALREADY_CLOSED' },
      409,
    );

    await expect(resolveReport(REPORT.id, { action: 'DISMISS' })).rejects.toMatchObject({
      status: 409,
      code: 'REPORT_ALREADY_CLOSED',
    });
  });
});
