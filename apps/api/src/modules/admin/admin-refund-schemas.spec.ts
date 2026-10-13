import {
  ADMIN_REFUND_REFERENCE_MAX_LENGTH,
  abnormalPaymentKindSchema,
  adminDecideRefundRequestSchema,
  adminMarkRefundCompletedSchema,
  adminRefundListFilterSchema,
  adminRefundListQuerySchema,
  adminRefundPaymentSchema,
  adminRefundRequestListQuerySchema,
  adminRefundablePaymentListQuerySchema,
  paymentRefundStatusSchema,
  refundRequestStatusSchema,
} from '@ecommerce/types';
import { PaymentRefundStatus, RefundRequestStatus } from '@prisma/client';

// Schema Zod dùng chung cho khu Admin xử lý tiền hoàn (packages/types/src/admin-refund.ts, Week9.md 2.9).
// packages/types không có test runner riêng — test ở đây (cùng precedent admin-schemas.spec.ts).

const issuesOf = (
  schema: { safeParse: (input: unknown) => unknown },
  input: unknown,
) => {
  const result = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  };
  return result.success ? [] : (result.error?.issues ?? []);
};

describe('enum dùng chung khớp Prisma', () => {
  it('RefundRequestStatus', () => {
    expect([...refundRequestStatusSchema.options].sort()).toEqual(
      Object.values(RefundRequestStatus).sort(),
    );
  });

  it('PaymentRefundStatus — và bộ lọc "SUCCEEDED/FAILED/PENDING" của sổ cái là đúng các giá trị thật', () => {
    expect([...paymentRefundStatusSchema.options].sort()).toEqual(
      Object.values(PaymentRefundStatus).sort(),
    );
    const real = adminRefundListFilterSchema.options.filter(
      (option) => option !== 'NEEDS_ACTION',
    );
    expect([...real].sort()).toEqual(Object.values(PaymentRefundStatus).sort());
  });

  it('hai loại thanh toán bất thường', () => {
    expect([...abnormalPaymentKindSchema.options].sort()).toEqual([
      'DUPLICATE',
      'PAID_AFTER_EXPIRY',
    ]);
  });
});

describe('adminRefundRequestListQuerySchema', () => {
  it('mặc định hàng chờ khiếu nại ESCALATED, trang 1, 20 dòng', () => {
    expect(adminRefundRequestListQuerySchema.parse({})).toEqual({
      status: 'ESCALATED',
      page: 1,
      limit: 20,
    });
  });

  it('nhận mọi trạng thái (kể cả WITHDRAWN — Admin xem được tất cả), page/limit là chuỗi từ URL', () => {
    for (const status of refundRequestStatusSchema.options) {
      expect(
        adminRefundRequestListQuerySchema.parse({
          status,
          page: '2',
          limit: '50',
        }),
      ).toEqual({ status, page: 2, limit: 50 });
    }
  });

  it.each([
    { status: 'BAD' },
    { limit: '51' },
    { limit: '0' },
    { page: '0' },
    { page: '1.5' },
  ])('query %p ⇒ lỗi', (input) => {
    expect(issuesOf(adminRefundRequestListQuerySchema, input)).not.toHaveLength(
      0,
    );
  });
});

describe('adminRefundListQuerySchema', () => {
  it('mặc định NEEDS_ACTION (FAILED + PENDING bị bỏ dở)', () => {
    expect(adminRefundListQuerySchema.parse({})).toEqual({
      status: 'NEEDS_ACTION',
      page: 1,
      limit: 20,
    });
  });

  it.each(['NEEDS_ACTION', 'PENDING', 'FAILED', 'SUCCEEDED'])(
    'nhận bộ lọc %s',
    (status) => {
      expect(adminRefundListQuerySchema.parse({ status }).status).toBe(status);
    },
  );

  it.each([{ status: 'REFUNDED' }, { status: 'pending' }, { limit: '51' }])(
    'query %p ⇒ lỗi',
    (input) => {
      expect(issuesOf(adminRefundListQuerySchema, input)).not.toHaveLength(0);
    },
  );
});

describe('adminRefundablePaymentListQuerySchema', () => {
  it('mặc định trang 1, 20 dòng; giới hạn 50', () => {
    expect(adminRefundablePaymentListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
    });
    expect(
      issuesOf(adminRefundablePaymentListQuerySchema, { limit: '51' }),
    ).not.toHaveLength(0);
  });
});

describe('adminMarkRefundCompletedSchema', () => {
  it('cắt khoảng trắng hai đầu mã tham chiếu', () => {
    expect(
      adminMarkRefundCompletedSchema.parse({ reference: '  VNP-001 ' }),
    ).toEqual({ reference: 'VNP-001' });
  });

  it.each([{}, { reference: '' }, { reference: '   ' }])(
    'thiếu / rỗng (%p) ⇒ lỗi ở field reference với key i18n',
    (input) => {
      expect(issuesOf(adminMarkRefundCompletedSchema, input)).toEqual([
        expect.objectContaining({
          path: ['reference'],
          message: 'admin.validationRefundReferenceRequired',
        }),
      ]);
    },
  );

  it(`quá ${ADMIN_REFUND_REFERENCE_MAX_LENGTH} ký tự ⇒ lỗi key i18n; đúng ${ADMIN_REFUND_REFERENCE_MAX_LENGTH} thì được`, () => {
    expect(
      issuesOf(adminMarkRefundCompletedSchema, {
        reference: 'x'.repeat(ADMIN_REFUND_REFERENCE_MAX_LENGTH + 1),
      }),
    ).toEqual([
      expect.objectContaining({
        path: ['reference'],
        message: 'admin.validationRefundReferenceTooLong',
      }),
    ]);
    expect(
      issuesOf(adminMarkRefundCompletedSchema, {
        reference: 'x'.repeat(ADMIN_REFUND_REFERENCE_MAX_LENGTH),
      }),
    ).toHaveLength(0);
  });
});

describe('adminRefundPaymentSchema', () => {
  it('lý do tuỳ chọn: bỏ trống / "" ⇒ undefined', () => {
    expect(adminRefundPaymentSchema.parse({})).toEqual({ reason: undefined });
    expect(adminRefundPaymentSchema.parse({ reason: '  ' })).toEqual({
      reason: undefined,
    });
    expect(adminRefundPaymentSchema.parse({ reason: ' Trả hai lần ' })).toEqual(
      { reason: 'Trả hai lần' },
    );
  });

  it('quá 500 ký tự ⇒ lỗi key i18n', () => {
    expect(
      issuesOf(adminRefundPaymentSchema, { reason: 'x'.repeat(501) }),
    ).toEqual([
      expect.objectContaining({
        path: ['reason'],
        message: 'admin.validationReasonTooLong',
      }),
    ]);
  });
});

describe('adminDecideRefundRequestSchema (dùng cho POST /admin/refund-requests/:id/decide)', () => {
  it('duyệt không cần ghi chú; từ chối BẮT BUỘC ghi chú', () => {
    expect(
      adminDecideRefundRequestSchema.parse({ decision: 'APPROVE' }),
    ).toEqual({ decision: 'APPROVE', note: undefined });
    expect(
      issuesOf(adminDecideRefundRequestSchema, {
        decision: 'REJECT',
        note: '  ',
      }),
    ).toEqual([
      expect.objectContaining({
        path: ['note'],
        message: 'order.validationReasonRequired',
      }),
    ]);
  });

  it('decision lạ / thiếu ⇒ lỗi', () => {
    expect(
      issuesOf(adminDecideRefundRequestSchema, { decision: 'MAYBE' }),
    ).not.toHaveLength(0);
    expect(issuesOf(adminDecideRefundRequestSchema, {})).not.toHaveLength(0);
  });
});
