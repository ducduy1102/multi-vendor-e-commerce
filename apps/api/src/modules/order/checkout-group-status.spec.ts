import {
  canRetryFromStatus,
  deriveCheckoutGroupStatus,
  isValidOrderTransition,
  ORDER_STATUS_TRANSITIONS,
  type CheckoutGroupStatusOrder,
  type CheckoutGroupStatusPayment,
} from './checkout-group-status';

const NOW = new Date('2026-09-27T10:00:00.000Z');
const FUTURE = new Date('2026-09-27T11:00:00.000Z');
const PAST = new Date('2026-09-27T09:00:00.000Z');

function order(
  status: CheckoutGroupStatusOrder['status'],
): CheckoutGroupStatusOrder {
  return { status };
}

function payment(
  status: CheckoutGroupStatusPayment['status'],
  expiresAt: Date | null,
  createdAt = PAST,
): CheckoutGroupStatusPayment {
  return { status, expiresAt, createdAt };
}

describe('ORDER_STATUS_TRANSITIONS / isValidOrderTransition', () => {
  it('AWAITING_PAYMENT chỉ chuyển được sang PENDING hoặc CANCELLED', () => {
    expect(isValidOrderTransition('AWAITING_PAYMENT', 'PENDING')).toBe(true);
    expect(isValidOrderTransition('AWAITING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(isValidOrderTransition('AWAITING_PAYMENT', 'COMPLETED')).toBe(false);
  });

  it('chuyển sai bị chặn — vd CANCELLED → PENDING', () => {
    expect(isValidOrderTransition('CANCELLED', 'PENDING')).toBe(false);
  });

  it('bảng chuyển đúng như đã chốt (Week8.md 1.3)', () => {
    expect(ORDER_STATUS_TRANSITIONS).toEqual({
      AWAITING_PAYMENT: ['PENDING', 'CANCELLED'],
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PACKED'],
      PACKED: ['SHIPPING'],
      SHIPPING: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
      REFUNDED: [],
    });
  });

  it('luồng chính đi được từng bước tới COMPLETED', () => {
    const path = [
      'AWAITING_PAYMENT',
      'PENDING',
      'CONFIRMED',
      'PACKED',
      'SHIPPING',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidOrderTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('không nhảy cóc, không đi lùi, trạng thái cuối không đi đâu nữa', () => {
    expect(isValidOrderTransition('PENDING', 'SHIPPING')).toBe(false);
    expect(isValidOrderTransition('CONFIRMED', 'PENDING')).toBe(false);
    expect(isValidOrderTransition('SHIPPING', 'CONFIRMED')).toBe(false);
    expect(isValidOrderTransition('PACKED', 'CANCELLED')).toBe(false); // hủy sau xác nhận: Tuần 9
    expect(isValidOrderTransition('SHIPPING', 'CANCELLED')).toBe(false);
    for (const terminal of ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(ORDER_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('không có cạnh nào trỏ vào chính nó', () => {
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });
});

describe('deriveCheckoutGroupStatus', () => {
  it('Payment không hết hạn (expiresAt = null, COD) không bao giờ thành PAYMENT_EXPIRED', () => {
    const status = deriveCheckoutGroupStatus(
      [order('PENDING')],
      [payment('PENDING', null)],
      NOW,
    );
    expect(status).toBe('AWAITING_PAYMENT');
  });

  it('AWAITING_PAYMENT: đơn chưa huỷ, lần thử mới nhất PENDING chưa hết hạn', () => {
    const status = deriveCheckoutGroupStatus(
      [order('AWAITING_PAYMENT')],
      [payment('PENDING', FUTURE)],
      NOW,
    );
    expect(status).toBe('AWAITING_PAYMENT');
  });

  it('PAYMENT_FAILED: lần thử mới nhất FAILED, còn trong hạn giữ', () => {
    const status = deriveCheckoutGroupStatus(
      [order('AWAITING_PAYMENT')],
      [payment('FAILED', FUTURE)],
      NOW,
    );
    expect(status).toBe('PAYMENT_FAILED');
  });

  it('PAYMENT_EXPIRED: lần thử mới nhất quá hạn (PENDING hoặc FAILED), chưa bị thu hồi', () => {
    expect(
      deriveCheckoutGroupStatus(
        [order('AWAITING_PAYMENT')],
        [payment('PENDING', PAST)],
        NOW,
      ),
    ).toBe('PAYMENT_EXPIRED');
    expect(
      deriveCheckoutGroupStatus(
        [order('AWAITING_PAYMENT')],
        [payment('FAILED', PAST)],
        NOW,
      ),
    ).toBe('PAYMENT_EXPIRED');
  });

  it('PAID: đơn đã PENDING trở đi và có Payment SUCCESS', () => {
    const status = deriveCheckoutGroupStatus(
      [order('PENDING')],
      [payment('SUCCESS', PAST)],
      NOW,
    );
    expect(status).toBe('PAID');
  });

  it('CANCELLED: mọi đơn CANCELLED, không có Payment SUCCESS', () => {
    const status = deriveCheckoutGroupStatus(
      [order('CANCELLED'), order('CANCELLED')],
      [payment('FAILED', PAST)],
      NOW,
    );
    expect(status).toBe('CANCELLED');
  });

  it('PAID_AFTER_EXPIRY: có Payment SUCCESS nhưng mọi đơn đã CANCELLED (thanh toán muộn)', () => {
    const status = deriveCheckoutGroupStatus(
      [order('CANCELLED')],
      [payment('SUCCESS', PAST)],
      NOW,
    );
    expect(status).toBe('PAID_AFTER_EXPIRY');
  });

  it('nhiều shop — chỉ 1 đơn còn AWAITING_PAYMENT thì KHÔNG tính là allCancelled', () => {
    const status = deriveCheckoutGroupStatus(
      [order('CANCELLED'), order('AWAITING_PAYMENT')],
      [payment('FAILED', PAST)],
      NOW,
    );
    expect(status).toBe('PAYMENT_EXPIRED');
  });

  it('nhiều lần thử — chỉ lần MỚI NHẤT (createdAt lớn nhất) quyết định', () => {
    const status = deriveCheckoutGroupStatus(
      [order('AWAITING_PAYMENT')],
      [
        payment('FAILED', PAST, new Date('2026-09-27T08:00:00.000Z')),
        payment('PENDING', FUTURE, new Date('2026-09-27T09:30:00.000Z')),
      ],
      NOW,
    );
    expect(status).toBe('AWAITING_PAYMENT');
  });

  it('nhiều Payment SUCCESS (1.4, nhóm ≥2 lần thành công) vẫn là PAID, không lỗi', () => {
    const status = deriveCheckoutGroupStatus(
      [order('PENDING')],
      [payment('SUCCESS', PAST), payment('SUCCESS', FUTURE)],
      NOW,
    );
    expect(status).toBe('PAID');
  });
});

describe('canRetryFromStatus', () => {
  it('true cho AWAITING_PAYMENT và PAYMENT_FAILED', () => {
    expect(canRetryFromStatus('AWAITING_PAYMENT')).toBe(true);
    expect(canRetryFromStatus('PAYMENT_FAILED')).toBe(true);
  });

  it('false cho PAYMENT_EXPIRED/PAID/PAID_AFTER_EXPIRY/CANCELLED', () => {
    expect(canRetryFromStatus('PAYMENT_EXPIRED')).toBe(false);
    expect(canRetryFromStatus('PAID')).toBe(false);
    expect(canRetryFromStatus('PAID_AFTER_EXPIRY')).toBe(false);
    expect(canRetryFromStatus('CANCELLED')).toBe(false);
  });
});
