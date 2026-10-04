import {
  canActorTransitionShop,
  isShopEditable,
  resubmitShopSchema,
  SHOP_EDITABLE_STATUSES,
  SHOP_STATUS_TRANSITIONS,
  shopActorTypeSchema,
  shopStatusSchema,
  shopTransitionTargets,
  updateShopSchema,
  type ShopActorType,
  type ShopStatus,
} from '@ecommerce/types';
import { ShopActorType as PrismaShopActorType } from '@prisma/client';

// Bảng chuyển trạng thái shop kèm actor + schema dùng chung (packages/types/src/shop.ts, Week8.md 3C).
// packages/types không có test runner riêng — test ở đây (cùng precedent admin-schemas.spec.ts).

const STATUSES = shopStatusSchema.options;
const ACTORS = shopActorTypeSchema.options;

describe('enum dùng chung khớp Prisma', () => {
  it('ShopActorType', () => {
    expect([...shopActorTypeSchema.options].sort()).toEqual(
      Object.values(PrismaShopActorType).sort(),
    );
  });
});

describe('SHOP_STATUS_TRANSITIONS', () => {
  it('đúng bảng đã chốt (nguyên bảng, kể cả actor của từng cạnh)', () => {
    expect(SHOP_STATUS_TRANSITIONS).toEqual([
      { from: 'PENDING', to: 'APPROVED', actor: 'ADMIN' },
      { from: 'PENDING', to: 'REJECTED', actor: 'ADMIN' },
      { from: 'REJECTED', to: 'PENDING', actor: 'OWNER' },
      { from: 'APPROVED', to: 'SUSPENDED', actor: 'ADMIN' },
      { from: 'SUSPENDED', to: 'APPROVED', actor: 'ADMIN' },
    ]);
  });

  it('mỗi cặp (from, to) chỉ xuất hiện 1 lần — mỗi cạnh có đúng 1 actor', () => {
    const keys = SHOP_STATUS_TRANSITIONS.map(
      (edge) => `${edge.from}>${edge.to}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('không trạng thái nào tự trỏ vào chính nó', () => {
    for (const edge of SHOP_STATUS_TRANSITIONS) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it('mọi cạnh dùng trạng thái và actor có thật trong enum', () => {
    for (const edge of SHOP_STATUS_TRANSITIONS) {
      expect(STATUSES).toContain(edge.from);
      expect(STATUSES).toContain(edge.to);
      expect(ACTORS).toContain(edge.actor);
    }
  });

  it('chủ shop chỉ có đúng 1 cạnh (REJECTED → PENDING) và KHÔNG BAO GIỜ tự đưa shop tới APPROVED', () => {
    const ownerEdges = SHOP_STATUS_TRANSITIONS.filter(
      (edge) => edge.actor === 'OWNER',
    );

    expect(ownerEdges).toEqual([
      { from: 'REJECTED', to: 'PENDING', actor: 'OWNER' },
    ]);
    expect(ownerEdges.map((edge) => edge.to)).not.toContain('APPROVED');
  });

  it('chỉ có 1 đường vào PENDING: chủ shop nộp lại từ REJECTED (shop mới tạo ở PENDING không qua bảng này)', () => {
    const intoPending = SHOP_STATUS_TRANSITIONS.filter(
      (edge) => edge.to === 'PENDING',
    );

    expect(intoPending).toEqual([
      { from: 'REJECTED', to: 'PENDING', actor: 'OWNER' },
    ]);
  });

  it('SYSTEM chưa có cạnh nào (chỉ dùng cho backfill/hệ thống sau này)', () => {
    expect(
      SHOP_STATUS_TRANSITIONS.filter((edge) => edge.actor === 'SYSTEM'),
    ).toHaveLength(0);
  });
});

describe('canActorTransitionShop', () => {
  // Đối chiếu TOÀN BỘ ma trận actor × from × to với bảng — không chỉ vài ô đại diện.
  const allowed = new Set(
    SHOP_STATUS_TRANSITIONS.map(
      (edge) => `${edge.actor}:${edge.from}>${edge.to}`,
    ),
  );

  const matrix = ACTORS.flatMap((actor) =>
    STATUSES.flatMap((from) =>
      STATUSES.map(
        (to) =>
          [actor, from, to, allowed.has(`${actor}:${from}>${to}`)] as const,
      ),
    ),
  );

  it.each(matrix)('%s: %s → %s ⇒ %s', (actor, from, to, expected) => {
    expect(canActorTransitionShop(actor, from, to)).toBe(expected);
  });

  it('Admin KHÔNG làm được cạnh của chủ shop (REJECTED → PENDING) và ngược lại', () => {
    expect(canActorTransitionShop('ADMIN', 'REJECTED', 'PENDING')).toBe(false);
    expect(canActorTransitionShop('OWNER', 'REJECTED', 'PENDING')).toBe(true);
    expect(canActorTransitionShop('OWNER', 'PENDING', 'APPROVED')).toBe(false);
    expect(canActorTransitionShop('ADMIN', 'PENDING', 'APPROVED')).toBe(true);
  });
});

describe('shopTransitionTargets', () => {
  it.each<[ShopActorType, ShopStatus, ShopStatus[]]>([
    ['ADMIN', 'PENDING', ['APPROVED', 'REJECTED']],
    ['ADMIN', 'APPROVED', ['SUSPENDED']],
    ['ADMIN', 'SUSPENDED', ['APPROVED']],
    ['ADMIN', 'REJECTED', []],
    ['OWNER', 'REJECTED', ['PENDING']],
    ['OWNER', 'PENDING', []],
    ['OWNER', 'APPROVED', []],
    ['OWNER', 'SUSPENDED', []],
    ['SYSTEM', 'PENDING', []],
  ])('%s từ %s đi tới %j', (actor, from, expected) => {
    expect(shopTransitionTargets(actor, from)).toEqual(expected);
  });
});

describe('resubmitShopSchema', () => {
  it('dùng lại đúng schema sửa shop (không định nghĩa lại field)', () => {
    expect(resubmitShopSchema).toBe(updateShopSchema);
  });

  it('body rỗng {} hợp lệ — nộp lại không sửa gì', () => {
    expect(resubmitShopSchema.parse({})).toEqual({});
  });

  it('mọi field đều tuỳ chọn: chỉ gửi name cũng được', () => {
    expect(resubmitShopSchema.parse({ name: 'Tên mới' })).toEqual({
      name: 'Tên mới',
    });
  });

  it('status/slug không gửi lên được — bị bỏ qua, không vào dữ liệu đã parse', () => {
    const parsed = resubmitShopSchema.parse({
      name: 'A',
      status: 'APPROVED',
      slug: 'hack',
    });

    expect(parsed).toEqual({ name: 'A' });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('slug');
  });

  it('chuỗi rỗng ở field tuỳ chọn coi như chưa nhập', () => {
    expect(resubmitShopSchema.parse({ description: '', logoUrl: '' })).toEqual({
      description: undefined,
      logoUrl: undefined,
    });
  });

  it('URL logo sai bị từ chối với key i18n của shop', () => {
    const result = resubmitShopSchema.safeParse({ logoUrl: 'khong-phai-url' });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe(
      'shop.validationLogoUrlInvalid',
    );
  });

  it('tên chỉ toàn khoảng trắng bị từ chối (như khi tạo shop)', () => {
    expect(resubmitShopSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('SHOP_EDITABLE_STATUSES / isShopEditable', () => {
  it('chỉ REJECTED (sửa rồi nộp lại) và APPROVED (như hiện tại) sửa được', () => {
    expect([...SHOP_EDITABLE_STATUSES].sort()).toEqual([
      'APPROVED',
      'REJECTED',
    ]);
  });

  it.each<[ShopStatus, boolean]>([
    ['PENDING', false], // đang chờ duyệt: khoá để không đổi nội dung sau lưng người duyệt
    ['SUSPENDED', false], // đang bị khoá: khoá để không đổi thông tin né lý do
    ['REJECTED', true],
    ['APPROVED', true],
  ])('%s ⇒ sửa được: %s', (status, expected) => {
    expect(isShopEditable(status)).toBe(expected);
  });

  it('mọi trạng thái đều được phân loại rõ (sửa được hoặc không) — không trạng thái nào bị bỏ sót', () => {
    for (const status of STATUSES) {
      expect(typeof isShopEditable(status)).toBe('boolean');
    }
  });

  it('shop REJECTED luôn sửa được — nếu không, nút "Lưu và gửi duyệt lại" vô nghĩa', () => {
    expect(isShopEditable('REJECTED')).toBe(true);
  });
});
