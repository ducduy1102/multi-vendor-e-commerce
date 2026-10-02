import type { OrderStatus, PaymentMethod } from '@prisma/client';
import {
  canRetryOrderPayment,
  getBuyerOrderActions,
  getSellerOrderActions,
  type RetryPaymentInput,
} from './order-actions';
import { ORDER_STATUS_TRANSITIONS } from './checkout-group-status';

describe('getBuyerOrderActions', () => {
  const actions = (
    status: OrderStatus,
    paymentMethod: PaymentMethod | null,
    canRetryPayment = false,
  ) => getBuyerOrderActions({ status, paymentMethod, canRetryPayment });

  describe('canCancel — chỉ khi chưa đụng tới tiền thật (Week8.md 1.5)', () => {
    it('đơn chưa thanh toán: hủy được (theo cả nhóm thanh toán)', () => {
      expect(actions('AWAITING_PAYMENT', 'VNPAY').canCancel).toBe(true);
    });

    it('đơn COD chờ shop xác nhận: hủy được', () => {
      expect(actions('PENDING', 'COD').canCancel).toBe(true);
    });

    it.each(['VNPAY', 'MOMO'] as const)(
      'đơn đã trả online (%s) chờ xác nhận: CHƯA hủy được (hoàn tiền: Tuần 9)',
      (method) => {
        expect(actions('PENDING', method).canCancel).toBe(false);
      },
    );

    it.each([
      'CONFIRMED',
      'PACKED',
      'SHIPPING',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ] as const)('đơn %s không hủy được (kể cả COD)', (status) => {
      expect(actions(status, 'COD').canCancel).toBe(false);
    });
  });

  it('canConfirmReceived chỉ khi đang giao (SHIPPING)', () => {
    for (const status of [
      'AWAITING_PAYMENT',
      'PENDING',
      'CONFIRMED',
      'PACKED',
      'COMPLETED',
      'CANCELLED',
    ] as const) {
      expect(actions(status, 'COD').canConfirmReceived).toBe(false);
    }
    expect(actions('SHIPPING', 'COD').canConfirmReceived).toBe(true);
  });

  it('canRetryPayment đi qua nguyên giá trị do nơi gọi tính', () => {
    expect(actions('AWAITING_PAYMENT', 'VNPAY', true).canRetryPayment).toBe(
      true,
    );
    expect(actions('AWAITING_PAYMENT', 'VNPAY', false).canRetryPayment).toBe(
      false,
    );
  });
});

describe('canRetryOrderPayment', () => {
  const NOW = new Date('2026-10-01T10:00:00.000Z');
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
  const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000);

  const base = (
    overrides: Partial<RetryPaymentInput> = {},
  ): RetryPaymentInput => ({
    orderStatus: 'AWAITING_PAYMENT',
    payments: [
      {
        method: 'VNPAY',
        status: 'FAILED',
        expiresAt: minutesAhead(5),
        createdAt: minutesAgo(2),
      },
    ],
    groupCreatedAt: minutesAgo(3),
    now: NOW,
    maxHoldMinutes: 30,
    ...overrides,
  });

  it('lần thử mới nhất thất bại còn trong hạn giữ chỗ — thử lại được', () => {
    expect(canRetryOrderPayment(base())).toBe(true);
  });

  it('lần thử mới nhất đang chờ (PENDING) chưa hết hạn — vẫn cho mở lại link thanh toán', () => {
    expect(
      canRetryOrderPayment(
        base({
          payments: [
            {
              method: 'VNPAY',
              status: 'PENDING',
              expiresAt: minutesAhead(5),
              createdAt: minutesAgo(1),
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('đơn không phải AWAITING_PAYMENT — không thử lại', () => {
    expect(canRetryOrderPayment(base({ orderStatus: 'PENDING' }))).toBe(false);
    expect(canRetryOrderPayment(base({ orderStatus: 'CANCELLED' }))).toBe(
      false,
    );
  });

  it('lần thử mới nhất đã quá hạn (chưa kịp thu hồi) — không thử lại', () => {
    expect(
      canRetryOrderPayment(
        base({
          payments: [
            {
              method: 'VNPAY',
              status: 'PENDING',
              expiresAt: minutesAgo(1),
              createdAt: minutesAgo(16),
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('lần thử mới nhất là COD (không cổng, không hết hạn) — không có gì để thử lại', () => {
    expect(
      canRetryOrderPayment(
        base({
          payments: [
            {
              method: 'COD',
              status: 'PENDING',
              expiresAt: null,
              createdAt: minutesAgo(1),
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('nhóm đã vượt thời gian giữ chỗ tối đa — không thử lại dù lần thử còn hạn', () => {
    expect(canRetryOrderPayment(base({ groupCreatedAt: minutesAgo(31) }))).toBe(
      false,
    );
  });

  it('chọn lần thử mới nhất theo createdAt, không theo thứ tự mảng', () => {
    expect(
      canRetryOrderPayment(
        base({
          payments: [
            {
              method: 'VNPAY',
              status: 'FAILED',
              expiresAt: minutesAhead(5),
              createdAt: minutesAgo(1),
            },
            {
              method: 'COD',
              status: 'PENDING',
              expiresAt: null,
              createdAt: minutesAgo(10),
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('không có lần thử nào — không thử lại', () => {
    expect(canRetryOrderPayment(base({ payments: [] }))).toBe(false);
  });
});

describe('getSellerOrderActions', () => {
  const actions = (status: OrderStatus, paymentMethod: PaymentMethod | null) =>
    getSellerOrderActions({ status, paymentMethod });

  it.each([
    ['PENDING', { canConfirm: true, canPack: false, canShip: false }],
    ['CONFIRMED', { canConfirm: false, canPack: true, canShip: false }],
    ['PACKED', { canConfirm: false, canPack: false, canShip: true }],
  ] as const)('%s chỉ bật đúng 1 bước tiếp theo', (status, expected) => {
    expect(actions(status, 'VNPAY')).toMatchObject(expected);
  });

  it.each([
    'AWAITING_PAYMENT',
    'SHIPPING',
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
  ] as const)(
    'đơn %s: không có hành động nào (seller không tự hoàn tất đơn)',
    (status) => {
      expect(actions(status, 'COD')).toEqual({
        canConfirm: false,
        canPack: false,
        canShip: false,
        canReject: false,
      });
    },
  );

  describe('canReject — chỉ đơn COD chưa thu tiền (hoàn tiền online: Tuần 9)', () => {
    it('PENDING + COD: từ chối được', () => {
      expect(actions('PENDING', 'COD').canReject).toBe(true);
    });

    it.each(['VNPAY', 'MOMO'] as const)(
      'PENDING + %s (đã trả online): CHƯA từ chối được',
      (method) => {
        expect(actions('PENDING', method).canReject).toBe(false);
      },
    );

    it('PENDING không rõ phương thức thanh toán: không từ chối', () => {
      expect(actions('PENDING', null).canReject).toBe(false);
    });

    it.each(['CONFIRMED', 'PACKED', 'SHIPPING'] as const)(
      '%s (kể cả COD): không từ chối được sau khi đã xác nhận',
      (status) => {
        expect(actions(status, 'COD').canReject).toBe(false);
      },
    );
  });

  it.each([
    ['canConfirm', 'PENDING', 'CONFIRMED'],
    ['canPack', 'CONFIRMED', 'PACKED'],
    ['canShip', 'PACKED', 'SHIPPING'],
    ['canReject', 'PENDING', 'CANCELLED'],
  ] as const)(
    '%s ứng với cạnh hợp lệ %s → %s của ORDER_STATUS_TRANSITIONS',
    (_flag, from, to) => {
      expect(ORDER_STATUS_TRANSITIONS[from]).toContain(to);
    },
  );
});
