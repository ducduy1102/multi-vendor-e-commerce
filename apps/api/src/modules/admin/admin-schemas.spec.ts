import {
  ADMIN_SHOP_REASON_MAX_LENGTH,
  ADMIN_SHOP_STATUSES_REQUIRING_REASON,
  adminShopListQuerySchema,
  adminShopListResponseSchema,
  adminShopTargetStatusSchema,
  adminShopSchema,
  adminUpdateShopStatusSchema,
  shopSchema,
  shopStatusSchema,
  shopTransitionTargets,
} from '@ecommerce/types';
import { ShopStatus } from '@prisma/client';

// Schema Zod dùng chung cho khu Admin (packages/types/src/{shop,admin}.ts, Week8.md 2.10).
// packages/types không có test runner riêng — test ở đây (cùng precedent order-schemas.spec.ts).

describe('enum dùng chung khớp Prisma', () => {
  it('ShopStatus', () => {
    expect([...shopStatusSchema.options].sort()).toEqual(
      Object.values(ShopStatus).sort(),
    );
  });
});

// Bảng chuyển trạng thái (cạnh + actor) được test ở modules/shop/shop-status-transitions.spec.ts; ở đây chỉ
// giữ ràng buộc riêng của Admin: tập đích của body phải đúng bằng tập đích ADMIN của bảng.
describe('adminShopTargetStatusSchema', () => {
  it('tập đích của body (APPROVED/REJECTED/SUSPENDED) đúng bằng tập đích ADMIN có thật trong bảng', () => {
    const adminTargets = new Set(
      shopStatusSchema.options.flatMap((from) =>
        shopTransitionTargets('ADMIN', from),
      ),
    );

    expect([...adminShopTargetStatusSchema.options].sort()).toEqual(
      [...adminTargets].sort(),
    );
  });

  it('PENDING không phải đích của Admin (cạnh về PENDING thuộc chủ shop)', () => {
    expect(adminShopTargetStatusSchema.options).not.toContain('PENDING');
  });
});

describe('adminUpdateShopStatusSchema', () => {
  const issuesOf = (input: unknown) => {
    const result = adminUpdateShopStatusSchema.safeParse(input);
    return result.success ? [] : result.error.issues;
  };

  it('duyệt không cần lý do', () => {
    expect(adminUpdateShopStatusSchema.parse({ status: 'APPROVED' })).toEqual({
      status: 'APPROVED',
      reason: undefined,
    });
  });

  it.each(ADMIN_SHOP_STATUSES_REQUIRING_REASON)(
    '%s: thiếu lý do ⇒ lỗi ở field reason với key i18n',
    (status) => {
      expect(issuesOf({ status })).toEqual([
        expect.objectContaining({
          path: ['reason'],
          message: 'admin.validationReasonRequired',
        }),
      ]);
    },
  );

  it.each(['', '   '])(
    'lý do %j (rỗng/chỉ khoảng trắng) coi như chưa nhập',
    (reason) => {
      expect(issuesOf({ status: 'SUSPENDED', reason })).toEqual([
        expect.objectContaining({
          path: ['reason'],
          message: 'admin.validationReasonRequired',
        }),
      ]);
    },
  );

  it('lý do được cắt khoảng trắng hai đầu', () => {
    expect(
      adminUpdateShopStatusSchema.parse({
        status: 'REJECTED',
        reason: '  Thiếu giấy phép  ',
      }).reason,
    ).toBe('Thiếu giấy phép');
  });

  it('duyệt kèm lý do rỗng ⇒ reason là undefined (không phải chuỗi rỗng)', () => {
    expect(
      adminUpdateShopStatusSchema.parse({ status: 'APPROVED', reason: '' })
        .reason,
    ).toBeUndefined();
  });

  it('biên độ dài lý do: đúng 500 ký tự ổn, 501 bị từ chối', () => {
    expect(
      issuesOf({
        status: 'SUSPENDED',
        reason: 'a'.repeat(ADMIN_SHOP_REASON_MAX_LENGTH),
      }),
    ).toHaveLength(0);
    expect(
      issuesOf({
        status: 'SUSPENDED',
        reason: 'a'.repeat(ADMIN_SHOP_REASON_MAX_LENGTH + 1),
      }),
    ).toEqual([
      expect.objectContaining({ message: 'admin.validationReasonTooLong' }),
    ]);
  });

  it.each(['PENDING', 'approved', '', undefined, 42])(
    'status %j không phải đích hợp lệ',
    (status) => {
      expect(issuesOf({ status, reason: 'x' }).length).toBeGreaterThan(0);
    },
  );
});

describe('adminShopListQuerySchema', () => {
  it('mặc định: hàng chờ duyệt, trang 1, 20 dòng', () => {
    expect(adminShopListQuerySchema.parse({})).toEqual({
      status: 'PENDING',
      page: 1,
      limit: 20,
    });
  });

  it('query param là chuỗi ⇒ coerce sang số', () => {
    expect(
      adminShopListQuerySchema.parse({
        status: 'SUSPENDED',
        page: '3',
        limit: '50',
      }),
    ).toEqual({ status: 'SUSPENDED', page: 3, limit: 50 });
  });

  it.each([
    { status: 'DELETED' },
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { limit: '51' },
    { limit: '0' },
  ])('từ chối %j', (query) => {
    expect(adminShopListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('response schema', () => {
  const shop = {
    id: 's1',
    ownerId: 'u1',
    name: 'Shop A',
    slug: 'shop-a',
    logoUrl: null,
    bannerUrl: null,
    description: null,
    status: 'SUSPENDED',
    statusReason: 'Vi phạm',
    statusChangedAt: '2026-10-02T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
  const adminExtras = {
    owner: { name: 'An', email: 'an@example.com' },
    lastRejectionReason: null,
    resubmissionCount: 0,
  };

  it('shopSchema đọc được statusReason (không bị z.object strip mất)', () => {
    expect(shopSchema.parse(shop).statusReason).toBe('Vi phạm');
    expect(
      shopSchema.parse({ ...shop, statusReason: null }).statusReason,
    ).toBeNull();
  });

  it('shopSchema bắt buộc có statusReason (BE quên trả thì FE biết ngay)', () => {
    const { statusReason: _omitted, ...withoutReason } = shop;
    expect(shopSchema.safeParse(withoutReason).success).toBe(false);
  });

  it('shopSchema đọc được statusChangedAt (không bị z.object strip mất) và bắt buộc có', () => {
    expect(shopSchema.parse(shop).statusChangedAt).toBe(
      '2026-10-02T00:00:00.000Z',
    );
    const { statusChangedAt: _omitted, ...withoutChangedAt } = shop;
    expect(shopSchema.safeParse(withoutChangedAt).success).toBe(false);
  });

  it('adminShopSchema đọc được lastRejectionReason + resubmissionCount (suy từ history) và bắt buộc có cả hai', () => {
    const parsed = adminShopSchema.parse({
      ...shop,
      ...adminExtras,
      lastRejectionReason: 'Thiếu giấy phép',
      resubmissionCount: 2,
    });

    expect(parsed.lastRejectionReason).toBe('Thiếu giấy phép');
    expect(parsed.resubmissionCount).toBe(2);
    const { lastRejectionReason: _a, ...withoutReason } = {
      ...shop,
      ...adminExtras,
    };
    const { resubmissionCount: _b, ...withoutCount } = {
      ...shop,
      ...adminExtras,
    };
    expect(adminShopSchema.safeParse(withoutReason).success).toBe(false);
    expect(adminShopSchema.safeParse(withoutCount).success).toBe(false);
  });

  it.each([-1, 1.5, '2'])(
    'resubmissionCount %j không hợp lệ (phải là số nguyên không âm)',
    (resubmissionCount) => {
      expect(
        adminShopSchema.safeParse({
          ...shop,
          ...adminExtras,
          resubmissionCount,
        }).success,
      ).toBe(false);
    },
  );

  it('danh sách admin: mỗi shop kèm chủ shop (name + email)', () => {
    const parsed = adminShopListResponseSchema.parse({
      items: [{ ...shop, ...adminExtras }],
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(parsed.items[0].owner).toEqual({
      name: 'An',
      email: 'an@example.com',
    });
  });

  it('thiếu chủ shop thì không parse được', () => {
    expect(
      adminShopListResponseSchema.safeParse({
        items: [shop],
        total: 1,
        page: 1,
        limit: 20,
      }).success,
    ).toBe(false);
  });
});
