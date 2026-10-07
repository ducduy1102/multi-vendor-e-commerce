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
  method: CheckoutGroupStatusPayment['method'] = 'VNPAY',
): CheckoutGroupStatusPayment {
  return { method, status, expiresAt, createdAt };
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

  it('bảng chuyển đúng như đã chốt (Week8.md 1.3, thêm 3 cạnh ở Week9.md 1.4)', () => {
    expect(ORDER_STATUS_TRANSITIONS).toEqual({
      AWAITING_PAYMENT: ['PENDING', 'CANCELLED'],
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PACKED', 'CANCELLED'],
      PACKED: ['SHIPPING', 'CANCELLED'],
      SHIPPING: ['COMPLETED'],
      COMPLETED: ['REFUNDED'],
      CANCELLED: [],
      REFUNDED: [],
    });
  });

  it('3 cạnh mới của Tuần 9: hủy sau xác nhận/đóng gói và hoàn trả sau khi hoàn tất', () => {
    expect(isValidOrderTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(isValidOrderTransition('PACKED', 'CANCELLED')).toBe(true);
    expect(isValidOrderTransition('COMPLETED', 'REFUNDED')).toBe(true);
  });

  it('đang giao (SHIPPING) KHÔNG hủy được; hủy rồi không hoàn trả; đơn chưa hoàn tất không REFUNDED', () => {
    expect(isValidOrderTransition('SHIPPING', 'CANCELLED')).toBe(false);
    expect(isValidOrderTransition('CANCELLED', 'REFUNDED')).toBe(false);
    expect(isValidOrderTransition('SHIPPING', 'REFUNDED')).toBe(false);
    expect(isValidOrderTransition('PACKED', 'REFUNDED')).toBe(false);
    expect(isValidOrderTransition('REFUNDED', 'COMPLETED')).toBe(false);
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
    expect(isValidOrderTransition('SHIPPING', 'CANCELLED')).toBe(false);
    for (const terminal of ['CANCELLED', 'REFUNDED'] as const) {
      expect(ORDER_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
    // COMPLETED không còn là trạng thái cuối: chỉ còn một đường đi tiếp, REFUNDED (trả hàng được duyệt).
    expect(ORDER_STATUS_TRANSITIONS.COMPLETED).toEqual(['REFUNDED']);
  });

  it('không có cạnh nào trỏ vào chính nó', () => {
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });
});

describe('deriveCheckoutGroupStatus', () => {
  describe('COD (Week8.md 1.6) — chưa thu tiền, không hết hạn', () => {
    const cod = (
      status: CheckoutGroupStatusPayment['status'] = 'PENDING',
      createdAt = PAST,
    ) => payment(status, null, createdAt, 'COD');

    it('COD_PLACED: đơn đã đặt (PENDING), Payment COD PENDING không hạn', () => {
      expect(deriveCheckoutGroupStatus([order('PENDING')], [cod()], NOW)).toBe(
        'COD_PLACED',
      );
    });

    it('vẫn COD_PLACED khi các đơn đã sang CONFIRMED/PACKED/SHIPPING (còn đơn hoạt động, chưa thu tiền)', () => {
      for (const status of ['CONFIRMED', 'PACKED', 'SHIPPING'] as const) {
        expect(deriveCheckoutGroupStatus([order(status)], [cod()], NOW)).toBe(
          'COD_PLACED',
        );
      }
    });

    it('nhóm nhiều đơn: 1 đơn hủy, 1 đơn còn hoạt động ⇒ COD_PLACED', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('CANCELLED'), order('PENDING')],
          [cod()],
          NOW,
        ),
      ).toBe('COD_PLACED');
    });

    it('mọi đơn đã hủy ⇒ CANCELLED (không còn gì để giao)', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('CANCELLED'), order('CANCELLED')],
          [cod()],
          NOW,
        ),
      ).toBe('CANCELLED');
    });

    it('đã thu tiền (Payment COD SUCCESS, các đơn COMPLETED) ⇒ PAID', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('COMPLETED'), order('CANCELLED')],
          [cod('SUCCESS')],
          NOW,
        ),
      ).toBe('PAID');
    });

    it('KHÔNG BAO GIỜ PAYMENT_EXPIRED/PAYMENT_FAILED dù đã đặt rất lâu (không có hạn)', () => {
      const veryOld = new Date('2020-01-01T00:00:00.000Z');
      expect(
        deriveCheckoutGroupStatus(
          [order('PENDING')],
          [cod('PENDING', veryOld)],
          NOW,
        ),
      ).toBe('COD_PLACED');
    });

    it('COD_PLACED không "thử lại thanh toán" được', () => {
      expect(canRetryFromStatus('COD_PLACED')).toBe(false);
    });
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

  // Week9.md 1.2/1.3 — giá trị dẫn xuất phải biết các trạng thái mới (note-nestjs.md BL).
  describe('sau hoàn tiền / hoàn trả (Week9.md)', () => {
    it('đã hoàn đủ tiền (Payment REFUNDED), mọi đơn đã CANCELLED/REFUNDED ⇒ CANCELLED, KHÔNG rơi nhầm xuống "lần thử mới nhất" thành PAYMENT_FAILED/EXPIRED', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('CANCELLED'), order('CANCELLED')],
          [payment('REFUNDED', PAST)],
          NOW,
        ),
      ).toBe('CANCELLED');
      expect(
        deriveCheckoutGroupStatus(
          [order('REFUNDED'), order('CANCELLED')],
          [payment('REFUNDED', PAST)],
          NOW,
        ),
      ).toBe('CANCELLED');
      // Cùng kết quả dù lần thử đã quá hạn từ lâu (bug cũ: PAYMENT_EXPIRED).
      expect(
        deriveCheckoutGroupStatus(
          [order('REFUNDED')],
          [payment('REFUNDED', PAST)],
          NOW,
        ),
      ).toBe('CANCELLED');
    });

    it('mọi đơn REFUNDED mà Payment còn SUCCESS (hoàn tiền đang chạy) ⇒ PAID, không phải PAID_AFTER_EXPIRY', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('REFUNDED')],
          [payment('SUCCESS', PAST)],
          NOW,
        ),
      ).toBe('PAID');
    });

    it('hoàn một phần: Payment vẫn SUCCESS, còn đơn COMPLETED ⇒ PAID', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('REFUNDED'), order('COMPLETED')],
          [payment('SUCCESS', PAST)],
          NOW,
        ),
      ).toBe('PAID');
    });

    it('PAID_AFTER_EXPIRY chỉ dành cho đơn CANCELLED (thanh toán đến trễ), không phải REFUNDED', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('CANCELLED'), order('REFUNDED')],
          [payment('SUCCESS', PAST)],
          NOW,
        ),
      ).toBe('PAID');
    });

    it('COD hủy toàn bộ: Payment COD CANCELLED ("không thu") ⇒ CANCELLED', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('CANCELLED'), order('CANCELLED')],
          [payment('CANCELLED', null, PAST, 'COD')],
          NOW,
        ),
      ).toBe('CANCELLED');
    });

    it('nhóm còn đơn đang sống thì REFUNDED/CANCELLED của đơn khác không làm nhóm "kết thúc"', () => {
      expect(
        deriveCheckoutGroupStatus(
          [order('REFUNDED'), order('PENDING')],
          [payment('PENDING', null, PAST, 'COD')],
          NOW,
        ),
      ).toBe('COD_PLACED');
    });
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
