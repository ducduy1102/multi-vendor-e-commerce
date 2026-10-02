import {
  ADMIN_SHOP_REASON_MAX_LENGTH,
  ADMIN_SHOP_STATUSES_REQUIRING_REASON,
  adminShopListQuerySchema,
  adminShopListResponseSchema,
  adminShopTargetStatusSchema,
  adminUpdateShopStatusSchema,
  isValidShopStatusTransition,
  shopSchema,
  shopStatusSchema,
  SHOP_STATUS_TRANSITIONS,
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

describe('SHOP_STATUS_TRANSITIONS', () => {
  it('đúng bảng 1.8 (nguyên bảng, không chỉ vài cạnh)', () => {
    expect(SHOP_STATUS_TRANSITIONS).toEqual({
      PENDING: ['APPROVED', 'REJECTED'],
      APPROVED: ['SUSPENDED'],
      SUSPENDED: ['APPROVED'],
      REJECTED: [],
    });
  });

  it('có khoá cho mọi ShopStatus', () => {
    expect(Object.keys(SHOP_STATUS_TRANSITIONS).sort()).toEqual(
      [...shopStatusSchema.options].sort(),
    );
  });

  it('không cạnh nào dẫn về PENDING và REJECTED là trạng thái cuối', () => {
    const targets = Object.values(SHOP_STATUS_TRANSITIONS).flat();

    expect(targets).not.toContain('PENDING');
    expect(SHOP_STATUS_TRANSITIONS.REJECTED).toHaveLength(0);
  });

  it('không trạng thái nào tự trỏ vào chính nó', () => {
    for (const status of shopStatusSchema.options) {
      expect(SHOP_STATUS_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('isValidShopStatusTransition khớp bảng', () => {
    expect(isValidShopStatusTransition('PENDING', 'APPROVED')).toBe(true);
    expect(isValidShopStatusTransition('APPROVED', 'SUSPENDED')).toBe(true);
    expect(isValidShopStatusTransition('SUSPENDED', 'APPROVED')).toBe(true);
    expect(isValidShopStatusTransition('APPROVED', 'APPROVED')).toBe(false);
    expect(isValidShopStatusTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(isValidShopStatusTransition('REJECTED', 'APPROVED')).toBe(false);
    expect(isValidShopStatusTransition('PENDING', 'SUSPENDED')).toBe(false);
  });

  it('tập đích của body (APPROVED/REJECTED/SUSPENDED) đúng bằng tập đích có thật trong bảng', () => {
    const targets = new Set(Object.values(SHOP_STATUS_TRANSITIONS).flat());

    expect([...adminShopTargetStatusSchema.options].sort()).toEqual(
      [...targets].sort(),
    );
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
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
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

  it('danh sách admin: mỗi shop kèm chủ shop (name + email)', () => {
    const parsed = adminShopListResponseSchema.parse({
      items: [{ ...shop, owner: { name: 'An', email: 'an@example.com' } }],
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
