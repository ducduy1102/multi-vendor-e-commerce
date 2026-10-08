import {
  adminDecideRefundRequestSchema,
  approveRefundRequestSchema,
  blocksSellerFulfilment,
  buyerRefundRequestSchema,
  canActorTransitionRefundRequest,
  createRefundRequestSchema,
  ERROR_CODES,
  errorDetailsSchemas,
  hasErrorDetails,
  isRefundReasonAllowedForKind,
  isRefundRequestTerminal,
  orderActorTypeSchema,
  orderRefundSummarySchema,
  paymentRefundStatusSchema,
  paymentStatusSchema,
  REFUND_NOTE_MAX_LENGTH,
  REFUND_REASON_CODES,
  REFUND_REASON_CODES_BY_KIND,
  REFUND_REQUEST_TERMINAL_STATUSES,
  REFUND_REQUEST_TRANSITIONS,
  refundReasonCodeSchema,
  refundRequestHistoryItemSchema,
  refundRequestKindSchema,
  refundRequestStatusSchema,
  refundRequestTargets,
  rejectRefundRequestSchema,
  type OrderActorType,
  type RefundRequestKind,
  type RefundRequestStatus,
} from '@ecommerce/types';
import {
  PaymentRefundStatus,
  PaymentStatus,
  RefundRequestKind as PrismaRefundRequestKind,
  RefundRequestStatus as PrismaRefundRequestStatus,
} from '@prisma/client';

// Schema Zod dùng chung cho yêu cầu hủy/trả hàng và hoàn tiền (packages/types/src/refund.ts,
// Week9.md 2.2). packages/types không có test runner riêng — test ở đây (cùng precedent
// order-schemas.spec.ts).

describe('enum dùng chung khớp Prisma', () => {
  it.each([
    [
      'RefundRequestKind',
      refundRequestKindSchema.options,
      PrismaRefundRequestKind,
    ],
    [
      'RefundRequestStatus',
      refundRequestStatusSchema.options,
      PrismaRefundRequestStatus,
    ],
    [
      'PaymentRefundStatus',
      paymentRefundStatusSchema.options,
      PaymentRefundStatus,
    ],
    [
      'PaymentStatus (có CANCELLED = "không thu")',
      paymentStatusSchema.options,
      PaymentStatus,
    ],
  ])('%s', (_name, zodOptions, prismaEnum) => {
    expect([...zodOptions].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});

type Edge = [
  OrderActorType,
  RefundRequestKind,
  RefundRequestStatus,
  RefundRequestStatus,
];

const ACTORS = orderActorTypeSchema.options;
const KINDS = refundRequestKindSchema.options;
const STATUSES = refundRequestStatusSchema.options;

const bothKinds = (
  actor: OrderActorType,
  from: RefundRequestStatus,
  to: RefundRequestStatus,
): Edge[] => KINDS.map((kind) => [actor, kind, from, to]);

// Bảng chuyển viết LẠI ĐỘC LẬP với REFUND_REQUEST_TRANSITIONS (Week9.md 1.4) để test bắt được cả việc
// thêm nhầm lẫn bớt nhầm một cạnh.
const EXPECTED_EDGES: Edge[] = [
  ...bothKinds('SELLER', 'PENDING_SELLER', 'APPROVED'),
  ...bothKinds('SELLER', 'PENDING_SELLER', 'REJECTED_BY_SELLER'),
  ...bothKinds('ADMIN', 'PENDING_SELLER', 'APPROVED'),
  ...bothKinds('ADMIN', 'PENDING_SELLER', 'REJECTED'),
  ...bothKinds('ADMIN', 'ESCALATED', 'APPROVED'),
  ...bothKinds('ADMIN', 'ESCALATED', 'REJECTED'),
  // Seller nhượng bộ: tự hủy đơn trực tiếp khi người mua đã khiếu nại (chỉ kind CANCEL, Week9.md 2.5).
  ['SELLER', 'CANCEL', 'ESCALATED', 'APPROVED'],
  ...bothKinds('BUYER', 'PENDING_SELLER', 'WITHDRAWN'),
  ...bothKinds('BUYER', 'REJECTED_BY_SELLER', 'ESCALATED'),
  // Hệ thống chỉ hành động theo HẠN và đúng một hướng cho mỗi loại.
  ['SYSTEM', 'CANCEL', 'PENDING_SELLER', 'APPROVED'],
  ['SYSTEM', 'RETURN', 'PENDING_SELLER', 'ESCALATED'],
];

const edgeKey = (edge: Edge) => edge.join('>');

describe('REFUND_REQUEST_TRANSITIONS + canActorTransitionRefundRequest', () => {
  it('tập cạnh được phép (actor × loại × từ × đến) đúng bằng bảng thiết kế — không thừa, không thiếu', () => {
    const allowed: Edge[] = [];
    for (const actor of ACTORS) {
      for (const kind of KINDS) {
        for (const from of STATUSES) {
          for (const to of STATUSES) {
            if (canActorTransitionRefundRequest(actor, kind, from, to)) {
              allowed.push([actor, kind, from, to]);
            }
          }
        }
      }
    }

    expect(allowed.map(edgeKey).sort()).toEqual(
      EXPECTED_EDGES.map(edgeKey).sort(),
    );
    expect(allowed).toHaveLength(19);
  });

  it('khi yêu cầu đã lên sàn (ESCALATED): seller chỉ "nhượng bộ" được ở kind CANCEL; không tự duyệt trả hàng hay từ chối', () => {
    expect(
      canActorTransitionRefundRequest(
        'SELLER',
        'CANCEL',
        'ESCALATED',
        'APPROVED',
      ),
    ).toBe(true);
    expect(
      canActorTransitionRefundRequest(
        'SELLER',
        'RETURN',
        'ESCALATED',
        'APPROVED',
      ),
    ).toBe(false);
    expect(
      canActorTransitionRefundRequest(
        'SELLER',
        'CANCEL',
        'ESCALATED',
        'REJECTED',
      ),
    ).toBe(false);
  });

  it('mọi cạnh trong bảng dùng đúng giá trị enum hợp lệ', () => {
    for (const edge of REFUND_REQUEST_TRANSITIONS) {
      expect(STATUSES).toContain(edge.from);
      expect(STATUSES).toContain(edge.to);
      expect(ACTORS).toContain(edge.actor);
    }
  });

  it('trạng thái cuối (APPROVED/REJECTED/WITHDRAWN) không còn cạnh nào đi ra', () => {
    for (const status of REFUND_REQUEST_TERMINAL_STATUSES) {
      expect(
        REFUND_REQUEST_TRANSITIONS.filter((edge) => edge.from === status),
      ).toEqual([]);
      expect(isRefundRequestTerminal(status)).toBe(true);
    }
    expect(isRefundRequestTerminal('PENDING_SELLER')).toBe(false);
    expect(isRefundRequestTerminal('REJECTED_BY_SELLER')).toBe(false);
    expect(isRefundRequestTerminal('ESCALATED')).toBe(false);
  });

  it('seller không tự đưa yêu cầu lên ESCALATED, người mua không tự duyệt, Admin không rút hộ người mua', () => {
    expect(
      canActorTransitionRefundRequest(
        'SELLER',
        'RETURN',
        'PENDING_SELLER',
        'ESCALATED',
      ),
    ).toBe(false);
    expect(
      canActorTransitionRefundRequest(
        'BUYER',
        'CANCEL',
        'PENDING_SELLER',
        'APPROVED',
      ),
    ).toBe(false);
    expect(
      canActorTransitionRefundRequest(
        'ADMIN',
        'CANCEL',
        'PENDING_SELLER',
        'WITHDRAWN',
      ),
    ).toBe(false);
  });

  it('khiếu nại: chỉ người mua, và chỉ từ REJECTED_BY_SELLER (không khiếu nại khi seller chưa trả lời)', () => {
    expect(
      canActorTransitionRefundRequest(
        'BUYER',
        'RETURN',
        'REJECTED_BY_SELLER',
        'ESCALATED',
      ),
    ).toBe(true);
    expect(
      canActorTransitionRefundRequest(
        'BUYER',
        'RETURN',
        'PENDING_SELLER',
        'ESCALATED',
      ),
    ).toBe(false);
    expect(
      canActorTransitionRefundRequest(
        'SELLER',
        'RETURN',
        'REJECTED_BY_SELLER',
        'ESCALATED',
      ),
    ).toBe(false);
  });

  it('hệ thống: hủy trước giao quá hạn ⇒ tự duyệt; trả hàng quá hạn ⇒ chuyển Admin, KHÔNG tự duyệt tiền', () => {
    expect(
      canActorTransitionRefundRequest(
        'SYSTEM',
        'CANCEL',
        'PENDING_SELLER',
        'APPROVED',
      ),
    ).toBe(true);
    expect(
      canActorTransitionRefundRequest(
        'SYSTEM',
        'RETURN',
        'PENDING_SELLER',
        'APPROVED',
      ),
    ).toBe(false);
    expect(
      canActorTransitionRefundRequest(
        'SYSTEM',
        'RETURN',
        'PENDING_SELLER',
        'ESCALATED',
      ),
    ).toBe(true);
    expect(
      canActorTransitionRefundRequest(
        'SYSTEM',
        'CANCEL',
        'PENDING_SELLER',
        'ESCALATED',
      ),
    ).toBe(false);
  });
});

describe('refundRequestTargets', () => {
  it('Admin từ PENDING_SELLER: duyệt hoặc từ chối (thay seller vắng mặt); từ ESCALATED: duyệt hoặc từ chối', () => {
    expect(refundRequestTargets('ADMIN', 'CANCEL', 'PENDING_SELLER')).toEqual([
      'APPROVED',
      'REJECTED',
    ]);
    expect(refundRequestTargets('ADMIN', 'RETURN', 'ESCALATED')).toEqual([
      'APPROVED',
      'REJECTED',
    ]);
  });

  it('seller: duyệt hoặc từ chối khi PENDING_SELLER, không còn gì sau khi đã từ chối', () => {
    expect(refundRequestTargets('SELLER', 'RETURN', 'PENDING_SELLER')).toEqual([
      'APPROVED',
      'REJECTED_BY_SELLER',
    ]);
    expect(
      refundRequestTargets('SELLER', 'RETURN', 'REJECTED_BY_SELLER'),
    ).toEqual([]);
  });

  it('seller khi yêu cầu đã ESCALATED: chỉ kind CANCEL mới có đích (APPROVED)', () => {
    expect(refundRequestTargets('SELLER', 'CANCEL', 'ESCALATED')).toEqual([
      'APPROVED',
    ]);
    expect(refundRequestTargets('SELLER', 'RETURN', 'ESCALATED')).toEqual([]);
  });

  it('hệ thống: đích phụ thuộc loại yêu cầu', () => {
    expect(refundRequestTargets('SYSTEM', 'CANCEL', 'PENDING_SELLER')).toEqual([
      'APPROVED',
    ]);
    expect(refundRequestTargets('SYSTEM', 'RETURN', 'PENDING_SELLER')).toEqual([
      'ESCALATED',
    ]);
  });

  it('người mua: rút khi PENDING_SELLER, khiếu nại khi REJECTED_BY_SELLER', () => {
    expect(refundRequestTargets('BUYER', 'CANCEL', 'PENDING_SELLER')).toEqual([
      'WITHDRAWN',
    ]);
    expect(
      refundRequestTargets('BUYER', 'RETURN', 'REJECTED_BY_SELLER'),
    ).toEqual(['ESCALATED']);
    expect(refundRequestTargets('BUYER', 'RETURN', 'ESCALATED')).toEqual([]);
  });
});

describe('blocksSellerFulfilment', () => {
  it.each([
    ['CANCEL', 'PENDING_SELLER', true],
    ['CANCEL', 'ESCALATED', true],
    ['CANCEL', 'REJECTED_BY_SELLER', false],
    ['CANCEL', 'APPROVED', false],
    ['CANCEL', 'REJECTED', false],
    ['CANCEL', 'WITHDRAWN', false],
    // Yêu cầu TRẢ HÀNG chỉ có khi đơn đã COMPLETED — không còn gì để đóng gói/giao.
    ['RETURN', 'PENDING_SELLER', false],
    ['RETURN', 'ESCALATED', false],
  ] as const)('%s ở %s ⇒ chặn đóng gói/giao = %s', (kind, status, expected) => {
    expect(blocksSellerFulfilment(kind, status)).toBe(expected);
  });
});

describe('lý do hủy/trả hàng', () => {
  it('mã theo loại là tập con của REFUND_REASON_CODES, hợp lại đúng bằng toàn bộ, đều có OTHER', () => {
    const union = new Set([
      ...REFUND_REASON_CODES_BY_KIND.CANCEL,
      ...REFUND_REASON_CODES_BY_KIND.RETURN,
    ]);

    expect([...union].sort()).toEqual([...REFUND_REASON_CODES].sort());
    expect(REFUND_REASON_CODES_BY_KIND.CANCEL).toContain('OTHER');
    expect(REFUND_REASON_CODES_BY_KIND.RETURN).toContain('OTHER');
    expect(new Set(REFUND_REASON_CODES).size).toBe(REFUND_REASON_CODES.length);
  });

  it('isRefundReasonAllowedForKind: lý do hàng lỗi chỉ hợp với trả hàng, đổi ý chỉ hợp với hủy', () => {
    expect(isRefundReasonAllowedForKind('RETURN', 'DAMAGED')).toBe(true);
    expect(isRefundReasonAllowedForKind('CANCEL', 'DAMAGED')).toBe(false);
    expect(isRefundReasonAllowedForKind('CANCEL', 'CHANGE_OF_MIND')).toBe(true);
    expect(isRefundReasonAllowedForKind('RETURN', 'CHANGE_OF_MIND')).toBe(
      false,
    );
    expect(isRefundReasonAllowedForKind('CANCEL', 'OTHER')).toBe(true);
    expect(isRefundReasonAllowedForKind('RETURN', 'OTHER')).toBe(true);
  });

  it('refundReasonCodeSchema: thiếu và mã lạ là 2 thông điệp khác nhau', () => {
    const missing = refundReasonCodeSchema.safeParse(undefined);
    const unknown = refundReasonCodeSchema.safeParse('BORED');

    expect(missing.success ? null : missing.error.issues[0].message).toBe(
      'order.validationRefundReasonRequired',
    );
    expect(unknown.success ? null : unknown.error.issues[0].message).toBe(
      'order.validationRefundReasonInvalid',
    );
  });
});

describe('createRefundRequestSchema', () => {
  const messages = (input: unknown) => {
    const result = createRefundRequestSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.message);
  };

  it('lý do hợp lệ, ghi chú tuỳ chọn', () => {
    expect(createRefundRequestSchema.parse({ reasonCode: 'DAMAGED' })).toEqual({
      reasonCode: 'DAMAGED',
    });
    expect(
      createRefundRequestSchema.parse({
        reasonCode: 'DAMAGED',
        reasonNote: '  Vỡ góc  ',
      }),
    ).toEqual({ reasonCode: 'DAMAGED', reasonNote: 'Vỡ góc' });
  });

  it('ghi chú rỗng "" coi như chưa nhập (bỏ field, không gửi chuỗi rỗng lên BE)', () => {
    const parsed = createRefundRequestSchema.parse({
      reasonCode: 'DAMAGED',
      reasonNote: '   ',
    });

    expect(parsed.reasonNote).toBeUndefined();
  });

  it('thiếu reasonCode ⇒ báo thiếu; mã lạ ⇒ báo không hợp lệ', () => {
    expect(messages({})).toEqual(['order.validationRefundReasonRequired']);
    expect(messages({ reasonCode: 'BORED' })).toEqual([
      'order.validationRefundReasonInvalid',
    ]);
  });

  it('chọn OTHER mà không ghi chú ⇒ lỗi gắn ở reasonNote; có ghi chú ⇒ hợp lệ', () => {
    const result = createRefundRequestSchema.safeParse({ reasonCode: 'OTHER' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['reasonNote']);
      expect(result.error.issues[0].message).toBe(
        'order.validationRefundNoteRequired',
      );
    }
    expect(messages({ reasonCode: 'OTHER', reasonNote: '   ' })).toEqual([
      'order.validationRefundNoteRequired',
    ]);
    expect(messages({ reasonCode: 'OTHER', reasonNote: 'Lý do khác' })).toEqual(
      [],
    );
  });

  it(`ghi chú tối đa ${REFUND_NOTE_MAX_LENGTH} ký tự (đếm sau khi trim)`, () => {
    expect(
      messages({
        reasonCode: 'DAMAGED',
        reasonNote: 'x'.repeat(REFUND_NOTE_MAX_LENGTH),
      }),
    ).toEqual([]);
    expect(
      messages({
        reasonCode: 'DAMAGED',
        reasonNote: 'x'.repeat(REFUND_NOTE_MAX_LENGTH + 1),
      }),
    ).toEqual(['order.validationRefundNoteTooLong']);
  });

  it('không nhận `kind` từ client (BE tự suy từ trạng thái đơn) — field lạ bị bỏ', () => {
    const parsed = createRefundRequestSchema.parse({
      reasonCode: 'DAMAGED',
      kind: 'CANCEL',
    });

    expect(parsed).not.toHaveProperty('kind');
  });
});

describe('schema quyết định của seller/Admin', () => {
  it('approve: ghi chú tuỳ chọn, rỗng ⇒ bỏ', () => {
    expect(approveRefundRequestSchema.parse({})).toEqual({});
    expect(
      approveRefundRequestSchema.parse({ note: '  ' }).note,
    ).toBeUndefined();
    expect(approveRefundRequestSchema.parse({ note: 'Đồng ý' })).toEqual({
      note: 'Đồng ý',
    });
  });

  it('reject (seller): ghi chú BẮT BUỘC, tối đa 500 ký tự', () => {
    const messagesOf = (input: unknown) => {
      const result = rejectRefundRequestSchema.safeParse(input);
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.message);
    };

    expect(messagesOf({})).toEqual(['order.validationReasonRequired']);
    expect(messagesOf({ note: '   ' })).toEqual([
      'order.validationReasonRequired',
    ]);
    expect(messagesOf({ note: 'Hàng đã dùng' })).toEqual([]);
    expect(
      messagesOf({ note: 'x'.repeat(REFUND_NOTE_MAX_LENGTH + 1) }),
    ).toEqual(['order.validationReasonTooLong']);
  });

  it('Admin decide: APPROVE không cần ghi chú, REJECT bắt buộc ghi chú (lỗi gắn ở note)', () => {
    expect(
      adminDecideRefundRequestSchema.parse({ decision: 'APPROVE' }),
    ).toEqual({
      decision: 'APPROVE',
    });
    expect(
      adminDecideRefundRequestSchema.safeParse({ decision: 'MAYBE' }).success,
    ).toBe(false);

    const reject = adminDecideRefundRequestSchema.safeParse({
      decision: 'REJECT',
    });
    expect(reject.success).toBe(false);
    if (!reject.success) {
      expect(reject.error.issues[0].path).toEqual(['note']);
      expect(reject.error.issues[0].message).toBe(
        'order.validationReasonRequired',
      );
    }
    expect(
      adminDecideRefundRequestSchema.safeParse({
        decision: 'REJECT',
        note: 'Không đủ bằng chứng',
      }).success,
    ).toBe(true);
  });
});

describe('response', () => {
  it('refundRequestHistoryItemSchema KHÔNG giữ actorId/fromStatus dù BE lỡ trả (không lộ danh tính)', () => {
    const parsed = refundRequestHistoryItemSchema.parse({
      toStatus: 'REJECTED_BY_SELLER',
      actorType: 'SELLER',
      note: 'Hàng đã qua sử dụng',
      createdAt: '2026-10-07T10:00:00.000Z',
      actorId: 'seller-user-id',
      fromStatus: 'PENDING_SELLER',
    });

    expect(parsed).toEqual({
      toStatus: 'REJECTED_BY_SELLER',
      actorType: 'SELLER',
      note: 'Hàng đã qua sử dụng',
      createdAt: '2026-10-07T10:00:00.000Z',
    });
  });

  it('buyerRefundRequestSchema: reasonCode là chuỗi thường (mã lạ BE thêm sau không làm hỏng parse đơn)', () => {
    const parsed = buyerRefundRequestSchema.parse({
      id: 'r1',
      kind: 'RETURN',
      status: 'PENDING_SELLER',
      reasonCode: 'SOME_FUTURE_CODE',
      reasonNote: null,
      sellerRespondBy: '2026-10-09T10:00:00.000Z',
      statusChangedAt: '2026-10-07T10:00:00.000Z',
      createdAt: '2026-10-07T10:00:00.000Z',
      history: [],
      canWithdraw: true,
      canEscalate: false,
    });

    expect(parsed.reasonCode).toBe('SOME_FUTURE_CODE');
  });

  it('orderRefundSummarySchema chỉ có trạng thái + số tiền (không lộ lý do lỗi nội bộ/mã cổng)', () => {
    const parsed = orderRefundSummarySchema.parse({
      status: 'FAILED',
      amount: '244500',
      failureReason: 'gateway timeout',
      gatewayRef: 'ref-1',
    });

    expect(parsed).toEqual({ status: 'FAILED', amount: '244500' });
  });
});

describe('mã lỗi mới của Tuần 9', () => {
  it('đã đăng ký trong ERROR_CODES', () => {
    for (const code of [
      'REFUND_REQUEST_NOT_ALLOWED',
      'REFUND_REQUEST_NOT_FOUND',
      'REFUND_REQUEST_INVALID_TRANSITION',
      'REFUND_REQUEST_PENDING',
      'PAYMENT_REFUND_NOT_FOUND',
      'PAYMENT_REFUND_NOT_RETRYABLE',
      'PAYMENT_NOT_REFUNDABLE',
      'REVIEW_NOT_ALLOWED',
      'REVIEW_NOT_FOUND',
      'REVIEW_EDIT_NOT_ALLOWED',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('chỉ REFUND_REQUEST_NOT_ALLOWED và REVIEW_NOT_ALLOWED có details trong số mã mới', () => {
    expect(hasErrorDetails('REFUND_REQUEST_NOT_ALLOWED')).toBe(true);
    expect(hasErrorDetails('REVIEW_NOT_ALLOWED')).toBe(true);
    expect(hasErrorDetails('REFUND_REQUEST_PENDING')).toBe(false);
    expect(hasErrorDetails('REFUND_REQUEST_INVALID_TRANSITION')).toBe(false);
    expect(hasErrorDetails('PAYMENT_NOT_REFUNDABLE')).toBe(false);
  });

  it.each([
    'NOT_ELIGIBLE_STATUS',
    'WINDOW_EXPIRED',
    'ALREADY_REQUESTED',
    'PAYMENT_NOT_COLLECTED',
  ])(
    'REFUND_REQUEST_NOT_ALLOWED.details.reason nhận %s, từ chối giá trị lạ',
    (reason) => {
      expect(
        errorDetailsSchemas.REFUND_REQUEST_NOT_ALLOWED.safeParse({ reason })
          .success,
      ).toBe(true);
      expect(
        errorDetailsSchemas.REFUND_REQUEST_NOT_ALLOWED.safeParse({
          reason: 'NOPE',
        }).success,
      ).toBe(false);
    },
  );

  it('ORDER_CANCEL_NOT_ALLOWED có thêm IN_TRANSIT (đơn đang giao không hủy được)', () => {
    expect(
      errorDetailsSchemas.ORDER_CANCEL_NOT_ALLOWED.safeParse({
        reason: 'IN_TRANSIT',
      }).success,
    ).toBe(true);
    expect(
      errorDetailsSchemas.ORDER_CANCEL_NOT_ALLOWED.safeParse({
        reason: 'PROCESSING_STARTED',
      }).success,
    ).toBe(true);
  });
});
