import type { OrderStatus, PaymentMethod } from '@prisma/client';
import type { RefundRequestKind } from '@ecommerce/types';
import {
  canRetryOrderPayment,
  getBuyerOrderActions,
  getCancelBlockReason,
  getSellerOrderActions,
  isWithinRefundWindow,
  type BuyerOrderActionsInput,
  type RetryPaymentInput,
} from './order-actions';
import { ORDER_STATUS_TRANSITIONS } from './checkout-group-status';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-10T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const ALL_STATUSES: readonly OrderStatus[] = [
  'AWAITING_PAYMENT',
  'PENDING',
  'CONFIRMED',
  'PACKED',
  'SHIPPING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

describe('isWithinRefundWindow', () => {
  it('còn trong cửa sổ khi chưa quá hạn', () => {
    expect(isWithinRefundWindow(daysAgo(3), NOW, 7)).toBe(true);
  });

  it('đúng thời điểm hết hạn vẫn còn trong cửa sổ (hạn chót bao gồm), sau 1 ms thì hết', () => {
    const completedAt = daysAgo(7);

    expect(isWithinRefundWindow(completedAt, NOW, 7)).toBe(true);
    expect(
      isWithinRefundWindow(completedAt, new Date(NOW.getTime() + 1), 7),
    ).toBe(false);
  });

  it('cửa sổ tính theo số ngày cấu hình', () => {
    expect(isWithinRefundWindow(daysAgo(10), NOW, 7)).toBe(false);
    expect(isWithinRefundWindow(daysAgo(10), NOW, 15)).toBe(true);
  });
});

describe('getBuyerOrderActions', () => {
  const actions = (
    status: OrderStatus,
    paymentMethod: PaymentMethod | null,
    canRetryPayment = false,
    extra: Partial<
      Pick<
        BuyerOrderActionsInput,
        'completedAt' | 'existingRequestKinds' | 'refundWindowDays'
      >
    > = {},
  ) =>
    getBuyerOrderActions({
      status,
      paymentMethod,
      canRetryPayment,
      completedAt: null,
      now: NOW,
      refundWindowDays: 7,
      existingRequestKinds: [],
      ...extra,
    });

  describe('canCancel — hủy NGAY, chưa đụng tới tiền thật (Week8.md 1.5)', () => {
    it('đơn chưa thanh toán: hủy được (theo cả nhóm thanh toán)', () => {
      expect(actions('AWAITING_PAYMENT', 'VNPAY').canCancel).toBe(true);
    });

    it('đơn COD chờ shop xác nhận: hủy được', () => {
      expect(actions('PENDING', 'COD').canCancel).toBe(true);
    });

    // Chính sách mới (Week9.md 1.3) cho hủy ngay cả đơn đã trả online, nhưng cờ chỉ bật ở 2.6 cùng lúc có
    // RefundService + route — test này ghim đúng trạng thái trung gian để không bật cờ sớm (nút bấm ra 409).
    it.each(['VNPAY', 'MOMO'] as const)(
      'đơn đã trả online (%s) chờ xác nhận: cờ canCancel CHƯA bật (mở ở 2.6 cùng RefundService)',
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

  describe('canRequestCancel — gửi yêu cầu hủy khi shop đã xác nhận/đóng gói (Week9.md 1.3)', () => {
    it.each(['COD', 'VNPAY', 'MOMO'] as const)(
      'CONFIRMED và PACKED (%s): gửi được yêu cầu hủy',
      (method) => {
        expect(actions('CONFIRMED', method).canRequestCancel).toBe(true);
        expect(actions('PACKED', method).canRequestCancel).toBe(true);
      },
    );

    it.each(ALL_STATUSES.filter((s) => s !== 'CONFIRMED' && s !== 'PACKED'))(
      '%s: không có yêu cầu hủy (chờ xác nhận thì hủy ngay, giao rồi thì không hủy)',
      (status) => {
        expect(actions(status, 'COD').canRequestCancel).toBe(false);
        expect(actions(status, 'VNPAY').canRequestCancel).toBe(false);
      },
    );

    it('đã có yêu cầu hủy (chưa rút) thì tắt — mỗi đơn tối đa một yêu cầu mỗi loại', () => {
      expect(
        actions('CONFIRMED', 'COD', false, { existingRequestKinds: ['CANCEL'] })
          .canRequestCancel,
      ).toBe(false);
    });

    it('chỉ có yêu cầu TRẢ HÀNG thì không chặn yêu cầu hủy (khác loại)', () => {
      expect(
        actions('CONFIRMED', 'COD', false, { existingRequestKinds: ['RETURN'] })
          .canRequestCancel,
      ).toBe(true);
    });

    it('canRequestCancel không bao giờ cùng bật với canCancel (hủy ngay vs xin hủy loại trừ nhau)', () => {
      for (const status of ALL_STATUSES) {
        for (const method of ['COD', 'VNPAY', null] as const) {
          const a = actions(status, method);
          expect(a.canCancel && a.canRequestCancel).toBe(false);
        }
      }
    });
  });

  describe('canRequestReturn — yêu cầu trả hàng/hoàn tiền sau khi nhận, trong cửa sổ (Week9.md 1.3)', () => {
    it('COMPLETED còn trong cửa sổ: gửi được (cả COD và online)', () => {
      for (const method of ['COD', 'VNPAY'] as const) {
        expect(
          actions('COMPLETED', method, false, { completedAt: daysAgo(3) })
            .canRequestReturn,
        ).toBe(true);
      }
    });

    it('đúng ngày hết hạn vẫn gửi được, quá hạn thì tắt', () => {
      expect(
        actions('COMPLETED', 'COD', false, { completedAt: daysAgo(7) })
          .canRequestReturn,
      ).toBe(true);
      expect(
        actions('COMPLETED', 'COD', false, {
          completedAt: new Date(daysAgo(7).getTime() - 1),
        }).canRequestReturn,
      ).toBe(false);
    });

    it('cửa sổ lấy từ cấu hình (refundWindowDays)', () => {
      expect(
        actions('COMPLETED', 'COD', false, {
          completedAt: daysAgo(10),
          refundWindowDays: 15,
        }).canRequestReturn,
      ).toBe(true);
      expect(
        actions('COMPLETED', 'COD', false, {
          completedAt: daysAgo(10),
          refundWindowDays: 7,
        }).canRequestReturn,
      ).toBe(false);
    });

    it('COMPLETED mà không rõ lúc hoàn tất (thiếu dòng lịch sử): không bật — thà khoá còn hơn mở không hạn', () => {
      expect(
        actions('COMPLETED', 'COD', false, { completedAt: null })
          .canRequestReturn,
      ).toBe(false);
    });

    it.each(ALL_STATUSES.filter((s) => s !== 'COMPLETED'))(
      '%s: không trả hàng được dù có completedAt (chưa nhận, hoặc đã hủy/hoàn)',
      (status) => {
        expect(
          actions(status, 'COD', false, { completedAt: daysAgo(1) })
            .canRequestReturn,
        ).toBe(false);
      },
    );

    it('đã có yêu cầu trả hàng thì tắt; yêu cầu HỦY cũ không chặn (khác loại)', () => {
      const kinds = (existingRequestKinds: RefundRequestKind[]) =>
        actions('COMPLETED', 'COD', false, {
          completedAt: daysAgo(1),
          existingRequestKinds,
        }).canRequestReturn;

      expect(kinds(['RETURN'])).toBe(false);
      expect(kinds(['CANCEL'])).toBe(true);
      expect(kinds(['CANCEL', 'RETURN'])).toBe(false);
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
  const actions = (
    status: OrderStatus,
    paymentMethod: PaymentMethod | null,
    hasBlockingCancelRequest = false,
  ) =>
    getSellerOrderActions({ status, paymentMethod, hasBlockingCancelRequest });

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
        canCancel: false,
      });
    },
  );

  describe('canReject — hiện vẫn chỉ đơn COD chưa thu tiền (online: mở ở 2.7 cùng RefundService)', () => {
    it('PENDING + COD: từ chối được', () => {
      expect(actions('PENDING', 'COD').canReject).toBe(true);
    });

    it.each(['VNPAY', 'MOMO'] as const)(
      'PENDING + %s (đã trả online): cờ canReject CHƯA bật',
      (method) => {
        expect(actions('PENDING', method).canReject).toBe(false);
      },
    );

    it('PENDING không rõ phương thức thanh toán: không từ chối', () => {
      expect(actions('PENDING', null).canReject).toBe(false);
    });

    it.each(['CONFIRMED', 'PACKED', 'SHIPPING'] as const)(
      '%s (kể cả COD): không từ chối được sau khi đã xác nhận (dùng "hủy đơn" thay thế)',
      (status) => {
        expect(actions(status, 'COD').canReject).toBe(false);
      },
    );
  });

  describe('canCancel — seller tự hủy đơn đã xác nhận/đóng gói (Week9.md 1.3)', () => {
    it.each(['COD', 'VNPAY', 'MOMO', null] as const)(
      'CONFIRMED và PACKED (%s): hủy được',
      (method) => {
        expect(actions('CONFIRMED', method).canCancel).toBe(true);
        expect(actions('PACKED', method).canCancel).toBe(true);
      },
    );

    it.each(ALL_STATUSES.filter((s) => s !== 'CONFIRMED' && s !== 'PACKED'))(
      '%s: không hủy kiểu này (chờ xác nhận thì từ chối; đã giao thì không hủy được)',
      (status) => {
        expect(actions(status, 'COD').canCancel).toBe(false);
      },
    );

    it('canReject và canCancel không bao giờ cùng bật (mỗi trạng thái đúng một đường)', () => {
      for (const status of ALL_STATUSES) {
        for (const method of ['COD', 'VNPAY', null] as const) {
          const a = actions(status, method);
          expect(a.canReject && a.canCancel).toBe(false);
        }
      }
    });
  });

  describe('đang có yêu cầu HỦY của người mua chờ xử lý (Week9.md 1.3)', () => {
    it('tắt đóng gói và giao hàng — phải phản hồi yêu cầu trước', () => {
      expect(actions('CONFIRMED', 'COD', true).canPack).toBe(false);
      expect(actions('PACKED', 'COD', true).canShip).toBe(false);
    });

    it('KHÔNG chặn tự hủy (hủy chính là cách trả lời) và không đụng tới xác nhận/từ chối', () => {
      expect(actions('CONFIRMED', 'COD', true).canCancel).toBe(true);
      expect(actions('PACKED', 'COD', true).canCancel).toBe(true);
      expect(actions('PENDING', 'COD', true)).toMatchObject({
        canConfirm: true,
        canReject: true,
      });
    });

    it('không có yêu cầu chờ thì đóng gói/giao như bình thường', () => {
      expect(actions('CONFIRMED', 'COD', false).canPack).toBe(true);
      expect(actions('PACKED', 'COD', false).canShip).toBe(true);
    });
  });

  it.each([
    ['canConfirm', 'PENDING', 'CONFIRMED'],
    ['canPack', 'CONFIRMED', 'PACKED'],
    ['canShip', 'PACKED', 'SHIPPING'],
    ['canReject', 'PENDING', 'CANCELLED'],
    ['canCancel', 'CONFIRMED', 'CANCELLED'],
    ['canCancel', 'PACKED', 'CANCELLED'],
  ] as const)(
    '%s ứng với cạnh hợp lệ %s → %s của ORDER_STATUS_TRANSITIONS',
    (_flag, from, to) => {
      expect(ORDER_STATUS_TRANSITIONS[from]).toContain(to);
    },
  );
});

describe('getCancelBlockReason', () => {
  it('PENDING + COD: hủy được (không có lý do chặn)', () => {
    expect(getCancelBlockReason('PENDING', 'COD')).toBeNull();
  });

  it.each(['VNPAY', 'MOMO', null] as const)(
    'PENDING + %s: PAID_ONLINE (còn tới 2.6/2.7 khi hủy ngay kèm hoàn tiền; không rõ phương thức thì chặn cho an toàn)',
    (method) => {
      expect(getCancelBlockReason('PENDING', method)).toBe('PAID_ONLINE');
    },
  );

  it.each(['CONFIRMED', 'PACKED'] as const)(
    '%s: PROCESSING_STARTED (kể cả COD) — người mua gửi yêu cầu hủy thay vì hủy ngay',
    (status) => {
      expect(getCancelBlockReason(status, 'COD')).toBe('PROCESSING_STARTED');
      expect(getCancelBlockReason(status, 'VNPAY')).toBe('PROCESSING_STARTED');
    },
  );

  it('SHIPPING: IN_TRANSIT (hàng đã giao cho vận chuyển, không hủy được) — tách khỏi PROCESSING_STARTED', () => {
    expect(getCancelBlockReason('SHIPPING', 'COD')).toBe('IN_TRANSIT');
    expect(getCancelBlockReason('SHIPPING', 'VNPAY')).toBe('IN_TRANSIT');
  });

  it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const)(
    '%s: không có lý do đặc biệt (nơi gọi báo ORDER_INVALID_TRANSITION / hủy theo nhóm)',
    (status) => {
      expect(getCancelBlockReason(status, 'COD')).toBeNull();
    },
  );
});
