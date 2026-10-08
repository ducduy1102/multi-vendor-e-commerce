import type {
  OrderStatus,
  PaymentMethod,
  PaymentRefundStatus,
} from '@prisma/client';
import type { RefundRequestKind, RefundRequestStatus } from '@ecommerce/types';
import {
  canRetryOrderPayment,
  getAdminRefundActions,
  getAdminRefundRequestActions,
  getBuyerOrderActions,
  getBuyerRefundRequestActions,
  getCancelBlockReason,
  getSellerOrderActions,
  getSellerRefundRequestActions,
  isWithinEscalateWindow,
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

describe('isWithinEscalateWindow', () => {
  it('còn trong hạn khiếu nại; đúng thời điểm hết hạn vẫn còn (bao gồm), sau 1 ms thì hết', () => {
    const rejectedAt = daysAgo(3);

    expect(isWithinEscalateWindow(daysAgo(1), NOW, 3)).toBe(true);
    expect(isWithinEscalateWindow(rejectedAt, NOW, 3)).toBe(true);
    expect(
      isWithinEscalateWindow(rejectedAt, new Date(NOW.getTime() + 1), 3),
    ).toBe(false);
  });

  it('hạn tính theo số ngày cấu hình', () => {
    expect(isWithinEscalateWindow(daysAgo(5), NOW, 3)).toBe(false);
    expect(isWithinEscalateWindow(daysAgo(5), NOW, 7)).toBe(true);
  });
});

describe('getBuyerRefundRequestActions (Week9.md 1.4)', () => {
  const STATUSES: readonly RefundRequestStatus[] = [
    'PENDING_SELLER',
    'APPROVED',
    'REJECTED_BY_SELLER',
    'ESCALATED',
    'REJECTED',
    'WITHDRAWN',
  ];
  const actions = (
    status: RefundRequestStatus,
    kind: RefundRequestKind = 'CANCEL',
    statusChangedAt: Date = daysAgo(1),
    escalateDays = 3,
  ) =>
    getBuyerRefundRequestActions({
      kind,
      status,
      statusChangedAt,
      now: NOW,
      escalateDays,
    });

  it('chỉ rút được khi seller CHƯA trả lời (PENDING_SELLER), cả hai loại yêu cầu', () => {
    for (const kind of ['CANCEL', 'RETURN'] as const) {
      for (const status of STATUSES) {
        expect(actions(status, kind).canWithdraw).toBe(
          status === 'PENDING_SELLER',
        );
      }
    }
  });

  it('chỉ khiếu nại được sau khi seller TỪ CHỐI và còn trong hạn', () => {
    for (const kind of ['CANCEL', 'RETURN'] as const) {
      for (const status of STATUSES) {
        expect(actions(status, kind).canEscalate).toBe(
          status === 'REJECTED_BY_SELLER',
        );
      }
    }
  });

  it('hết hạn khiếu nại (tính từ lúc seller từ chối) ⇒ tắt canEscalate, canWithdraw không liên quan', () => {
    const result = actions('REJECTED_BY_SELLER', 'RETURN', daysAgo(4), 3);

    expect(result).toEqual({ canWithdraw: false, canEscalate: false });
  });

  it('hạn khiếu nại theo cấu hình: cùng mốc từ chối, REFUND_ESCALATE_DAYS lớn hơn thì còn khiếu nại được', () => {
    expect(
      actions('REJECTED_BY_SELLER', 'CANCEL', daysAgo(4), 3).canEscalate,
    ).toBe(false);
    expect(
      actions('REJECTED_BY_SELLER', 'CANCEL', daysAgo(4), 7).canEscalate,
    ).toBe(true);
  });

  it('yêu cầu đang chờ seller: rút được, chưa khiếu nại được', () => {
    expect(actions('PENDING_SELLER')).toEqual({
      canWithdraw: true,
      canEscalate: false,
    });
  });

  it('yêu cầu đã lên sàn hoặc đã có kết quả cuối: người mua không làm gì thêm', () => {
    for (const status of [
      'ESCALATED',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ] as const) {
      expect(actions(status)).toEqual({
        canWithdraw: false,
        canEscalate: false,
      });
    }
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

    // Chính sách Week9.md 1.3, bật ở 2.6 cùng lúc có RefundService + route hủy: đơn đã trả online mà shop
    // chưa xác nhận hủy NGAY được, kèm hoàn tiền tự động. Trước 2.6 test này khẳng định ngược lại (false).
    it.each(['VNPAY', 'MOMO'] as const)(
      'đơn đã trả online (%s) chờ xác nhận: hủy được (kèm hoàn tiền)',
      (method) => {
        expect(actions('PENDING', method).canCancel).toBe(true);
      },
    );

    it('không rõ phương thức thanh toán (nhóm chưa có Payment): đơn chờ xác nhận vẫn hủy được', () => {
      expect(actions('PENDING', null).canCancel).toBe(true);
    });

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
  const actions = (status: OrderStatus, hasBlockingCancelRequest = false) =>
    getSellerOrderActions({ status, hasBlockingCancelRequest });

  it.each([
    ['PENDING', { canConfirm: true, canPack: false, canShip: false }],
    ['CONFIRMED', { canConfirm: false, canPack: true, canShip: false }],
    ['PACKED', { canConfirm: false, canPack: false, canShip: true }],
  ] as const)('%s chỉ bật đúng 1 bước tiếp theo', (status, expected) => {
    expect(actions(status)).toMatchObject(expected);
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
      expect(actions(status)).toEqual({
        canConfirm: false,
        canPack: false,
        canShip: false,
        canReject: false,
        canCancel: false,
      });
    },
  );

  // Từ 2.7 (Week9.md 1.3) từ chối đơn chờ xác nhận mở cho MỌI phương thức thanh toán: đơn đã trả online được
  // hoàn tiền tự động. Trước 2.7 các test này khẳng định ngược lại (chỉ COD).
  describe('canReject — từ chối đơn chờ xác nhận', () => {
    it('PENDING: từ chối được (cờ không còn phụ thuộc phương thức thanh toán)', () => {
      expect(actions('PENDING').canReject).toBe(true);
    });

    it.each(['CONFIRMED', 'PACKED', 'SHIPPING'] as const)(
      '%s: không từ chối được sau khi đã xác nhận (dùng "hủy đơn" thay thế)',
      (status) => {
        expect(actions(status).canReject).toBe(false);
      },
    );
  });

  describe('canCancel — seller tự hủy đơn đã xác nhận/đóng gói (Week9.md 1.3)', () => {
    it.each(['CONFIRMED', 'PACKED'] as const)('%s: hủy được', (status) => {
      expect(actions(status).canCancel).toBe(true);
    });

    it.each(ALL_STATUSES.filter((s) => s !== 'CONFIRMED' && s !== 'PACKED'))(
      '%s: không hủy kiểu này (chờ xác nhận thì từ chối; đã giao thì không hủy được)',
      (status) => {
        expect(actions(status).canCancel).toBe(false);
      },
    );

    it('canReject và canCancel không bao giờ cùng bật (mỗi trạng thái đúng một đường)', () => {
      for (const status of ALL_STATUSES) {
        const a = actions(status);
        expect(a.canReject && a.canCancel).toBe(false);
      }
    });
  });

  describe('đang có yêu cầu HỦY của người mua chờ xử lý (Week9.md 1.3)', () => {
    it('tắt đóng gói và giao hàng — phải phản hồi yêu cầu trước', () => {
      expect(actions('CONFIRMED', true).canPack).toBe(false);
      expect(actions('PACKED', true).canShip).toBe(false);
    });

    it('KHÔNG chặn tự hủy (hủy chính là cách trả lời) và không đụng tới xác nhận/từ chối', () => {
      expect(actions('CONFIRMED', true).canCancel).toBe(true);
      expect(actions('PACKED', true).canCancel).toBe(true);
      expect(actions('PENDING', true)).toMatchObject({
        canConfirm: true,
        canReject: true,
      });
    });

    it('không có yêu cầu chờ thì đóng gói/giao như bình thường', () => {
      expect(actions('CONFIRMED', false).canPack).toBe(true);
      expect(actions('PACKED', false).canShip).toBe(true);
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

describe('getSellerRefundRequestActions (Week9.md 1.4)', () => {
  const STATUSES: readonly RefundRequestStatus[] = [
    'PENDING_SELLER',
    'APPROVED',
    'REJECTED_BY_SELLER',
    'ESCALATED',
    'REJECTED',
    'WITHDRAWN',
  ];

  it('đang chờ seller: duyệt và từ chối được, cả hai loại yêu cầu', () => {
    for (const kind of ['CANCEL', 'RETURN'] as const) {
      expect(
        getSellerRefundRequestActions({ kind, status: 'PENDING_SELLER' }),
      ).toEqual({ canApprove: true, canReject: true });
    }
  });

  it('yêu cầu HỦY đã lên sàn: seller chỉ nhượng bộ (duyệt) được, không từ chối được nữa', () => {
    expect(
      getSellerRefundRequestActions({ kind: 'CANCEL', status: 'ESCALATED' }),
    ).toEqual({ canApprove: true, canReject: false });
  });

  it('yêu cầu TRẢ HÀNG đã lên sàn: Admin quyết định, seller không làm gì', () => {
    expect(
      getSellerRefundRequestActions({ kind: 'RETURN', status: 'ESCALATED' }),
    ).toEqual({ canApprove: false, canReject: false });
  });

  it.each(
    STATUSES.filter(
      (status) => status !== 'PENDING_SELLER' && status !== 'ESCALATED',
    ),
  )('trạng thái %s: seller không làm gì thêm', (status) => {
    for (const kind of ['CANCEL', 'RETURN'] as const) {
      expect(getSellerRefundRequestActions({ kind, status })).toEqual({
        canApprove: false,
        canReject: false,
      });
    }
  });
});

describe('getAdminRefundRequestActions (Week9.md 1.9)', () => {
  const STATUSES: readonly RefundRequestStatus[] = [
    'PENDING_SELLER',
    'APPROVED',
    'REJECTED_BY_SELLER',
    'ESCALATED',
    'REJECTED',
    'WITHDRAWN',
  ];

  // Admin quyết định cả yêu cầu đã lên sàn lẫn yêu cầu còn chờ seller (thay seller vắng mặt), cả hai loại.
  it.each(['PENDING_SELLER', 'ESCALATED'] as const)(
    '%s: duyệt và từ chối được, cả hai loại yêu cầu',
    (status) => {
      for (const kind of ['CANCEL', 'RETURN'] as const) {
        expect(getAdminRefundRequestActions({ kind, status })).toEqual({
          canApprove: true,
          canReject: true,
        });
      }
    },
  );

  // REJECTED_BY_SELLER chưa lên sàn: người mua còn quyền khiếu nại, Admin chưa can thiệp.
  it.each(
    STATUSES.filter(
      (status) => status !== 'PENDING_SELLER' && status !== 'ESCALATED',
    ),
  )('trạng thái %s: Admin không làm gì thêm', (status) => {
    for (const kind of ['CANCEL', 'RETURN'] as const) {
      expect(getAdminRefundRequestActions({ kind, status })).toEqual({
        canApprove: false,
        canReject: false,
      });
    }
  });
});

describe('getAdminRefundActions (Week9.md 1.9)', () => {
  const MIN_MS = 60 * 1000;
  const input = (status: PaymentRefundStatus, ageMs: number) => ({
    status,
    updatedAt: new Date(NOW.getTime() - ageMs),
    now: NOW,
  });

  it.each([0, MIN_MS, 30 * 24 * 60 * MIN_MS])(
    'FAILED (cũ bao lâu cũng vậy, tuổi %p ms): thử lại và ghi nhận thủ công được',
    (ageMs) => {
      expect(getAdminRefundActions(input('FAILED', ageMs))).toEqual({
        canRetry: true,
        canMarkCompleted: true,
      });
    },
  );

  it('PENDING mới (dưới 5 phút — lần gọi cổng có thể vẫn đang chạy): chưa làm gì được', () => {
    expect(getAdminRefundActions(input('PENDING', 5 * MIN_MS - 1))).toEqual({
      canRetry: false,
      canMarkCompleted: false,
    });
  });

  it('PENDING bỏ dở: đúng 5 phút trở lên là làm được (biên bao gồm)', () => {
    expect(getAdminRefundActions(input('PENDING', 5 * MIN_MS))).toEqual({
      canRetry: true,
      canMarkCompleted: true,
    });
    expect(getAdminRefundActions(input('PENDING', 60 * MIN_MS))).toEqual({
      canRetry: true,
      canMarkCompleted: true,
    });
  });

  it('SUCCEEDED: đã hoàn xong, không còn gì để làm', () => {
    expect(getAdminRefundActions(input('SUCCEEDED', 60 * MIN_MS))).toEqual({
      canRetry: false,
      canMarkCompleted: false,
    });
  });
});

describe('getCancelBlockReason', () => {
  it.each(['CONFIRMED', 'PACKED'] as const)(
    '%s: PROCESSING_STARTED — người mua gửi yêu cầu hủy thay vì hủy ngay',
    (status) => {
      expect(getCancelBlockReason(status)).toBe('PROCESSING_STARTED');
    },
  );

  it('SHIPPING: IN_TRANSIT (hàng đã giao cho vận chuyển, không hủy được) — tách khỏi PROCESSING_STARTED', () => {
    expect(getCancelBlockReason('SHIPPING')).toBe('IN_TRANSIT');
  });

  // PAID_ONLINE đã bị bỏ ở 2.7: đơn PENDING hủy ngay được cho MỌI phương thức (đã trả online thì hoàn tiền).
  it('PENDING: không có lý do chặn (kể cả đơn đã trả online — hoàn tiền tự động)', () => {
    expect(getCancelBlockReason('PENDING')).toBeNull();
  });

  it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const)(
    '%s: không có lý do đặc biệt (nơi gọi báo ORDER_INVALID_TRANSITION / hủy theo nhóm)',
    (status) => {
      expect(getCancelBlockReason(status)).toBeNull();
    },
  );
});
