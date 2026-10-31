import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeNotificationService,
  type FakeNotificationService,
} from '../../shared/testing/fake-notification-service';
import { AdminAppealsService } from './admin-appeals.service';
import type { AdminService } from './admin.service';
import type { ProductModerationService } from '../product/product-moderation.service';

// Logic không cần DB của AdminAppealsService (Week11.md 4.6 và 5.8): bộ lọc/thứ tự của hàng đợi, ánh xạ response không lộ gì ngoài
// allowlist, và luồng quyết định — thứ tự các bước, tính nguyên tử (chấp nhận + đóng kháng nghị + nhật ký cùng giao dịch), việc
// gửi thông báo/email chỉ SAU commit. Khoá hàng, trọng tài đua giữa hai Admin và CHECK thật trên Postgres do
// admin-appeals.controller.int-spec.ts kiểm.
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const APPEAL_ID = '22222222-2222-4222-8222-222222222222';
const SHOP_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_AT = new Date('2026-10-28T10:00:00.000Z');
const LATER_AT = new Date('2026-10-29T10:00:00.000Z');

function appealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPEAL_ID,
    targetType: 'SHOP' as const,
    targetId: SHOP_ID,
    status: 'PENDING' as const,
    message: 'Shop đã gỡ hàng bị báo cáo',
    decisionNote: null,
    decidedById: null,
    createdAt: new Date('2026-10-29T08:00:00.000Z'),
    decidedAt: null,
    moderationEventAt: EVENT_AT,
    ...overrides,
  };
}

function shopRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHOP_ID,
    name: 'Shop A',
    slug: 'shop-a',
    logoUrl: null,
    status: 'SUSPENDED' as const,
    statusReason: 'Bán hàng giả',
    statusChangedAt: EVENT_AT,
    owner: { name: 'Chủ shop', email: 'owner@example.com' },
    ...overrides,
  };
}

// Hàng của `SELECT ... FROM appeals ... FOR UPDATE` trong giao dịch quyết định.
function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PENDING',
    target_type: 'SHOP',
    target_id: SHOP_ID,
    moderation_event_at: EVENT_AT,
    ...overrides,
  };
}

// Sản phẩm của kháng nghị sản phẩm (Week11.md 5.8): đang bị gỡ, mốc gỡ trùng mốc kháng nghị ⇒ lần gỡ còn hiệu lực.
function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    shopId: SHOP_ID,
    name: 'Dao bấm tự động',
    slug: 'dao-bam-tu-dong',
    status: 'TAKEN_DOWN' as const,
    takenDownAt: EVENT_AT,
    takenDownReason: 'Hàng cấm theo quy định của sàn.',
    ...overrides,
  };
}

// Hàng của `SELECT shop_id, status, taken_down_at FROM products ... FOR UPDATE` trong giao dịch quyết định kháng nghị sản phẩm.
function lockedProductRow(overrides: Record<string, unknown> = {}) {
  return {
    shop_id: SHOP_ID,
    status: 'TAKEN_DOWN',
    taken_down_at: EVENT_AT,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    appeal: { findMany: jest.fn(), updateMany: jest.fn() },
    shop: { findMany: jest.fn(), findUnique: jest.fn() },
    product: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
  prisma.$queryRaw.mockResolvedValue([lockedRow()]);
  prisma.shop.findUnique.mockResolvedValue({
    status: 'SUSPENDED',
    statusChangedAt: EVENT_AT,
  });
  prisma.appeal.updateMany.mockResolvedValue({ count: 1 });
  prisma.appeal.findMany.mockResolvedValue([appealRow()]);
  prisma.shop.findMany.mockResolvedValue([shopRow()]);
  prisma.product.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);

  const adminService = {
    changeShopStatusInTx: jest.fn().mockResolvedValue('SUSPENDED'),
    announceShopStatusChange: jest.fn().mockResolvedValue({}),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const productModeration = {
    restoreInTx: jest.fn().mockResolvedValue(undefined),
  };
  const notifications: FakeNotificationService =
    createFakeNotificationService();
  const service = new AdminAppealsService(
    prisma as unknown as PrismaService,
    adminService as unknown as AdminService,
    auditService,
    notifications,
    productModeration as unknown as ProductModerationService,
  );
  return {
    service,
    prisma,
    adminService,
    auditService,
    notifications,
    productModeration,
  };
}

// Cấu hình mock cho một kháng nghị SẢN PHẨM đang chờ: khoá hàng kháng nghị rồi khoá hàng sản phẩm (hai `$queryRaw` liên tiếp), và các
// bảng được đọc lại để dựng response sau commit.
function mockProductAppeal(
  ctx: ReturnType<typeof setup>,
  {
    appeal = {},
    product = {},
    locked = {},
  }: {
    appeal?: Record<string, unknown>;
    product?: Record<string, unknown>;
    locked?: Record<string, unknown>;
  } = {},
) {
  ctx.prisma.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([
      lockedRow({ target_type: 'PRODUCT', target_id: PRODUCT_ID }),
    ])
    .mockResolvedValueOnce([lockedProductRow(locked)]);
  ctx.prisma.appeal.findMany.mockResolvedValue([
    appealRow({ targetType: 'PRODUCT', targetId: PRODUCT_ID, ...appeal }),
  ]);
  ctx.prisma.product.findMany.mockResolvedValue([productRow(product)]);
}

let log: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AdminAppealsService.list', () => {
  const QUERY = { status: 'PENDING' as const, page: 1, limit: 20 };

  // Hai truy vấn SQL thô chạy song song: [0] đếm tổng, [1] lấy id của trang.
  function sqlOf(prisma: ReturnType<typeof setup>['prisma'], index: number) {
    return (prisma.$queryRaw.mock.calls as [Prisma.Sql][])[index][0];
  }

  function mockIds(
    prisma: ReturnType<typeof setup>['prisma'],
    ids: string[],
    total = ids.length,
  ) {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: BigInt(total) }])
      .mockResolvedValueOnce(ids.map((id) => ({ id })));
  }

  // SQL được viết nhiều dòng; so sánh trên bản đã gộp khoảng trắng để không phụ thuộc cách xuống dòng.
  const flat = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, ' ');

  // Điều kiện "lần xử lý còn diễn ra" gồm HAI nhánh theo loại đối tượng (shop: còn SUSPENDED và mốc khoá khớp; sản phẩm: còn TAKEN_DOWN và
  // mốc gỡ khớp). Thiếu một nhánh là kháng nghị loại đó biến mất khỏi tab "Chờ xử lý" (hoặc luôn rơi vào "Đã đóng").
  const SHOP_EPISODE = `(a.target_type = 'SHOP' AND s.status = 'SUSPENDED' AND s.status_changed_at = a.moderation_event_at)`;
  const PRODUCT_EPISODE = `(a.target_type = 'PRODUCT' AND p.status = 'TAKEN_DOWN' AND p.taken_down_at = a.moderation_event_at)`;

  it('PENDING: còn chờ VÀ lần xử lý (khoá shop / gỡ sản phẩm) còn diễn ra, cũ nhất trước (id là khoá phụ)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);

    await service.list(QUERY);

    for (const index of [0, 1]) {
      const text = flat(sqlOf(prisma, index));
      expect(text).toContain(`a.status = 'PENDING' AND (`);
      expect(text).not.toContain(`a.status = 'PENDING' AND NOT`);
      expect(text).toContain(SHOP_EPISODE);
      expect(text).toContain(PRODUCT_EPISODE);
    }
    expect(sqlOf(prisma, 1).text).toContain(
      'ORDER BY a.created_at ASC, a.id ASC',
    );
  });

  it('CLOSED: còn PENDING nhưng lần xử lý đã kết thúc (phủ định đúng điều kiện của PENDING cho cả hai loại), mới nhất trước', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, []);

    await service.list({ ...QUERY, status: 'CLOSED' });

    const text = flat(sqlOf(prisma, 1));
    expect(text).toContain(`a.status = 'PENDING' AND NOT (`);
    expect(text).toContain(SHOP_EPISODE);
    expect(text).toContain(PRODUCT_EPISODE);
    expect(sqlOf(prisma, 1).text).toContain(
      'ORDER BY a.created_at DESC, a.id DESC',
    );
  });

  it.each(['ACCEPTED', 'REJECTED'] as const)(
    '%s: lọc theo trạng thái đã lưu, quyết định gần nhất trước',
    async (status) => {
      const { service, prisma } = setup();
      mockIds(prisma, []);

      await service.list({ ...QUERY, status });

      expect(sqlOf(prisma, 1).text).toContain(`a.status = '${status}'`);
      expect(sqlOf(prisma, 1).text).toContain(
        'ORDER BY a.decided_at DESC, a.id DESC',
      );
    },
  );

  it('đếm và phân trang dùng CÙNG một nguồn: cả hai loại đối tượng, shop của kháng nghị sản phẩm lấy từ sản phẩm, không lọc cứng theo SHOP', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, []);

    await service.list(QUERY);

    for (const index of [0, 1]) {
      const text = flat(sqlOf(prisma, index));
      expect(text).toContain(
        `FROM appeals a LEFT JOIN products p ON a.target_type = 'PRODUCT' AND p.id = a.target_id`,
      );
      expect(text).toContain(
        `JOIN shops s ON s.id = CASE a.target_type WHEN 'SHOP' THEN a.target_id ELSE p.shop_id END`,
      );
      // Bản cũ (4.6) lọc cứng `WHERE a.target_type = 'SHOP'` và INNER JOIN thẳng `shops` theo `target_id`: kháng nghị sản phẩm biến mất.
      expect(text).not.toMatch(/WHERE a\.target_type = 'SHOP'/);
    }
  });

  it('phân trang bằng tham số (không ghép chuỗi)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, []);

    await service.list({ ...QUERY, page: 3, limit: 20 });

    const page = sqlOf(prisma, 1);
    expect(page.text).toMatch(/LIMIT \$1 OFFSET \$2/);
    expect(page.values).toEqual([20, 40]);
  });

  it('trả total/page/limit; trang rỗng không chạm thêm bảng nào', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [], 0);

    const result = await service.list(QUERY);

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(prisma.appeal.findMany).not.toHaveBeenCalled();
    expect(prisma.shop.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('GIỮ thứ tự của truy vấn id (không phụ thuộc thứ tự findMany trả về)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, ['b', 'a']);
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({ id: 'a' }),
      appealRow({ id: 'b' }),
    ]);

    const result = await service.list(QUERY);

    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('số truy vấn không phụ thuộc số kháng nghị (một cho kháng nghị, một cho shop kèm chủ shop, một cho tên Admin)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, ['a', 'b', 'c']);
    prisma.appeal.findMany.mockResolvedValue(
      ['a', 'b', 'c'].map((id) =>
        appealRow({ id, status: 'ACCEPTED', decidedById: ADMIN_ID }),
      ),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, name: 'Quản trị' },
    ]);

    const result = await service.list(QUERY);

    expect(prisma.appeal.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.shop.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ADMIN_ID] } },
      select: { id: true, name: true },
    });
    expect(result.items.map((item) => item.decidedByName)).toEqual([
      'Quản trị',
      'Quản trị',
      'Quản trị',
    ]);
  });

  it('kháng nghị chưa quyết định ⇒ không tra tên Admin', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);

    await service.list(QUERY);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('Admin đã bị xoá ⇒ decidedByName null', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({ status: 'ACCEPTED', decidedById: OTHER_ADMIN_ID }),
    ]);

    const result = await service.list(QUERY);

    expect(result.items[0].decidedByName).toBeNull();
  });

  it('shop của kháng nghị đã bị xoá ⇒ bỏ kháng nghị đó thay vì ném lỗi', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);
    prisma.shop.findMany.mockResolvedValue([]);

    const result = await service.list(QUERY);

    expect(result.items).toEqual([]);
  });

  it('response đúng allowlist: có shop và chủ shop (tên + email), KHÔNG có SĐT, id người kháng nghị hay id Admin', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({
        appellantId: 'u1',
        status: 'REJECTED',
        decidedById: ADMIN_ID,
        decisionNote: 'Chưa đủ',
        decidedAt: LATER_AT,
      }),
    ]);
    prisma.shop.findMany.mockResolvedValue([
      shopRow({
        ownerId: 'u1',
        owner: {
          name: 'Chủ shop',
          email: 'owner@example.com',
          phone: '0901234567',
        },
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, name: 'Quản trị' },
    ]);

    const [item] = (await service.list(QUERY)).items;

    expect(Object.keys(item).sort()).toEqual([
      'createdAt',
      'decidedAt',
      'decidedByName',
      'decisionNote',
      'id',
      'message',
      'moderationEventAt',
      'owner',
      'product',
      'shop',
      'state',
      'targetType',
    ]);
    // Kháng nghị shop: không có khối sản phẩm.
    expect(item.targetType).toBe('SHOP');
    expect(item.product).toBeNull();
    expect(Object.keys(item.owner).sort()).toEqual(['email', 'name']);
    expect(Object.keys(item.shop).sort()).toEqual([
      'id',
      'logoUrl',
      'name',
      'slug',
      'status',
      'statusReason',
    ]);
    expect(JSON.stringify(item)).not.toMatch(
      /0901234567|appellantId|decidedById|ownerId|statusChangedAt/,
    );
  });

  it('trạng thái hiển thị suy ra từ shop: PENDING + shop đã được mở khoá ⇒ CLOSED', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);
    prisma.shop.findMany.mockResolvedValue([shopRow({ status: 'APPROVED' })]);

    const result = await service.list(QUERY);

    expect(result.items[0].state).toBe('CLOSED');
  });

  // Kháng nghị sản phẩm bị gỡ (Week11.md 5.8): hàng đợi chung với kháng nghị shop.
  describe('kháng nghị sản phẩm', () => {
    function listWithProductAppeal(
      ctx: ReturnType<typeof setup>,
      overrides: {
        appeal?: Record<string, unknown>;
        product?: Record<string, unknown>;
        shop?: Record<string, unknown>;
      } = {},
    ) {
      mockIds(ctx.prisma, [APPEAL_ID]);
      ctx.prisma.appeal.findMany.mockResolvedValue([
        appealRow({
          targetType: 'PRODUCT',
          targetId: PRODUCT_ID,
          ...overrides.appeal,
        }),
      ]);
      ctx.prisma.product.findMany.mockResolvedValue([
        productRow(overrides.product),
      ]);
      // Shop của kháng nghị sản phẩm đang HOẠT ĐỘNG bình thường (APPROVED) — trạng thái shop không liên quan tới lần gỡ sản phẩm.
      ctx.prisma.shop.findMany.mockResolvedValue([
        shopRow({ status: 'APPROVED', statusReason: null, ...overrides.shop }),
      ]);
    }

    it('dựng khối sản phẩm (id, tên, slug, lý do gỡ) + shop sở hữu sản phẩm + chủ shop', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx);

      const [item] = (await ctx.service.list(QUERY)).items;

      expect(item.targetType).toBe('PRODUCT');
      expect(item.product).toEqual({
        id: PRODUCT_ID,
        name: 'Dao bấm tự động',
        slug: 'dao-bam-tu-dong',
        takenDownReason: 'Hàng cấm theo quy định của sàn.',
      });
      expect(item.shop).toMatchObject({ id: SHOP_ID, name: 'Shop A' });
      expect(item.owner).toEqual({
        name: 'Chủ shop',
        email: 'owner@example.com',
      });
    });

    it('shop được tra theo shopId CỦA SẢN PHẨM (không theo target_id của kháng nghị)', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx);

      await ctx.service.list(QUERY);

      expect(ctx.prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: [PRODUCT_ID] } },
        select: expect.objectContaining({ shopId: true }) as unknown,
      });
      expect(ctx.prisma.shop.findMany).toHaveBeenCalledWith({
        where: { id: { in: [SHOP_ID] } },
        select: expect.anything() as unknown,
      });
    });

    it('PENDING + sản phẩm vẫn TAKEN_DOWN với đúng mốc gỡ ⇒ PENDING', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx);

      expect((await ctx.service.list(QUERY)).items[0].state).toBe('PENDING');
    });

    it.each([
      [
        'sản phẩm đã được khôi phục về nháp',
        { status: 'DRAFT', takenDownAt: null },
      ],
      [
        'sản phẩm bị gỡ lại một lần khác (mốc gỡ đã đổi)',
        { takenDownAt: LATER_AT },
      ],
    ])('PENDING + %s ⇒ CLOSED', async (_name, product) => {
      const ctx = setup();
      listWithProductAppeal(ctx, { product });

      expect((await ctx.service.list(QUERY)).items[0].state).toBe('CLOSED');
    });

    it('trạng thái shop KHÔNG ảnh hưởng kháng nghị sản phẩm: shop đang bị khoá cũng không làm kháng nghị sản phẩm CLOSED', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx, {
        shop: { status: 'SUSPENDED', statusChangedAt: LATER_AT },
      });

      expect((await ctx.service.list(QUERY)).items[0].state).toBe('PENDING');
    });

    it('ACCEPTED / REJECTED giữ nguyên trạng thái đã lưu, bất kể sản phẩm hiện giờ ra sao', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx, {
        appeal: { status: 'ACCEPTED', decidedById: ADMIN_ID },
        product: { status: 'DRAFT', takenDownAt: null },
      });
      ctx.prisma.user.findMany.mockResolvedValue([
        { id: ADMIN_ID, name: 'Quản trị' },
      ]);

      expect((await ctx.service.list(QUERY)).items[0].state).toBe('ACCEPTED');
    });

    it('sản phẩm đã bị xoá ⇒ bỏ kháng nghị đó thay vì ném lỗi', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx);
      ctx.prisma.product.findMany.mockResolvedValue([]);

      expect((await ctx.service.list(QUERY)).items).toEqual([]);
    });

    it('shop của sản phẩm đã bị xoá ⇒ bỏ kháng nghị đó', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx);
      ctx.prisma.shop.findMany.mockResolvedValue([]);

      expect((await ctx.service.list(QUERY)).items).toEqual([]);
    });

    it('hàng đợi lẫn hai loại: mỗi dòng đúng loại, đúng thứ tự, và vẫn chỉ MỘT truy vấn sản phẩm (không N+1)', async () => {
      const ctx = setup();
      const SHOP_APPEAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
      const OTHER_PRODUCT_APPEAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
      const OTHER_PRODUCT = '55555555-5555-4555-8555-555555555555';
      mockIds(ctx.prisma, [OTHER_PRODUCT_APPEAL, APPEAL_ID, SHOP_APPEAL]);
      ctx.prisma.appeal.findMany.mockResolvedValue([
        appealRow({ id: SHOP_APPEAL }),
        appealRow({
          id: APPEAL_ID,
          targetType: 'PRODUCT',
          targetId: PRODUCT_ID,
        }),
        appealRow({
          id: OTHER_PRODUCT_APPEAL,
          targetType: 'PRODUCT',
          targetId: OTHER_PRODUCT,
        }),
      ]);
      ctx.prisma.product.findMany.mockResolvedValue([
        productRow(),
        productRow({ id: OTHER_PRODUCT, name: 'Sản phẩm khác' }),
      ]);

      const result = await ctx.service.list(QUERY);

      expect(result.items.map((i) => [i.id, i.targetType])).toEqual([
        [OTHER_PRODUCT_APPEAL, 'PRODUCT'],
        [APPEAL_ID, 'PRODUCT'],
        [SHOP_APPEAL, 'SHOP'],
      ]);
      expect(result.items[0].product?.name).toBe('Sản phẩm khác');
      expect(result.items[2].product).toBeNull();
      expect(ctx.prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.shop.findMany).toHaveBeenCalledTimes(1);
    });

    it('response không lộ cột nội bộ của sản phẩm (shopId, status, takenDownAt) hay của kháng nghị (appellantId, decidedById)', async () => {
      const ctx = setup();
      listWithProductAppeal(ctx, {
        appeal: {
          appellantId: 'u1',
          decidedById: ADMIN_ID,
          status: 'REJECTED',
        },
      });
      ctx.prisma.user.findMany.mockResolvedValue([
        { id: ADMIN_ID, name: 'Quản trị' },
      ]);

      const [item] = (await ctx.service.list(QUERY)).items;

      expect(Object.keys(item.product ?? {}).sort()).toEqual([
        'id',
        'name',
        'slug',
        'takenDownReason',
      ]);
      expect(JSON.stringify(item)).not.toMatch(
        /appellantId|decidedById|ownerId|statusChangedAt|takenDownAt|takenDownById/,
      );
    });
  });
});

describe('AdminAppealsService.decide', () => {
  const ACCEPT = { decision: 'ACCEPT' as const };
  const REJECT = { decision: 'REJECT' as const, note: 'Giấy tờ chưa hợp lệ' };
  const CONTEXT = { ip: '203.0.113.7', userAgent: 'jest' };

  describe('đối tượng quyết định', () => {
    it.each(['not-a-uuid', '', `${APPEAL_ID}\u0000`])(
      'id sai dạng (%j) ⇒ 404 APPEAL_NOT_FOUND mà không chạm DB',
      async (id) => {
        const { service, prisma } = setup();

        await expectAppException(service.decide(ADMIN_ID, id, ACCEPT), {
          status: 404,
          code: 'APPEAL_NOT_FOUND',
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('id không tồn tại ⇒ cùng một 404', async () => {
      const { service, prisma } = setup();
      prisma.$queryRaw.mockResolvedValue([]);

      await expectAppException(service.decide(ADMIN_ID, APPEAL_ID, ACCEPT), {
        status: 404,
        code: 'APPEAL_NOT_FOUND',
      });
    });

    it('khoá hàng kháng nghị bằng FOR UPDATE (Admin thứ hai chờ rồi thấy status đã đổi)', async () => {
      const { service, prisma } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      const [[sql]] = prisma.$queryRaw.mock.calls as [Prisma.Sql][];
      expect(sql.text).toMatch(/FROM appeals WHERE id = \$1 FOR UPDATE/);
      expect(sql.values).toEqual([APPEAL_ID]);
    });
  });

  describe('điều kiện để quyết định', () => {
    async function expectRejectedUntouched(
      ctx: ReturnType<typeof setup>,
      code: string,
    ) {
      await expectAppException(
        ctx.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT),
        { status: 409, code },
      );
      expect(ctx.adminService.changeShopStatusInTx).not.toHaveBeenCalled();
      expect(ctx.prisma.appeal.updateMany).not.toHaveBeenCalled();
      expect(ctx.auditService.record).not.toHaveBeenCalled();
      expect(ctx.adminService.announceShopStatusChange).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    }

    it.each(['ACCEPTED', 'REJECTED'])(
      'đã %s (người khác quyết trước) ⇒ 409 APPEAL_ALREADY_DECIDED, không đổi gì',
      async (status) => {
        const ctx = setup();
        ctx.prisma.$queryRaw.mockResolvedValue([lockedRow({ status })]);

        await expectRejectedUntouched(ctx, 'APPEAL_ALREADY_DECIDED');
      },
    );

    it('shop đã được mở khoá bằng đường khác ⇒ 409 APPEAL_TARGET_CHANGED, không đổi gì', async () => {
      const ctx = setup();
      ctx.prisma.shop.findUnique.mockResolvedValue({
        status: 'APPROVED',
        statusChangedAt: LATER_AT,
      });

      await expectRejectedUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });

    it('shop bị khoá lại một lần khác (mốc đã đổi) ⇒ 409 APPEAL_TARGET_CHANGED: kháng nghị cũ không mở khoá được lần khoá mới', async () => {
      const ctx = setup();
      ctx.prisma.shop.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        statusChangedAt: LATER_AT,
      });

      await expectRejectedUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });

    it('shop đã bị xoá ⇒ 409 APPEAL_TARGET_CHANGED', async () => {
      const ctx = setup();
      ctx.prisma.shop.findUnique.mockResolvedValue(null);

      await expectRejectedUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });
  });

  describe('chấp nhận', () => {
    it('mở khoá shop (SUSPENDED → APPROVED) trong CÙNG giao dịch, TRƯỚC khi đóng kháng nghị', async () => {
      const { service, prisma, adminService } = setup();
      const order: string[] = [];
      adminService.changeShopStatusInTx.mockImplementation(() => {
        order.push('unsuspend');
        return Promise.resolve('SUSPENDED');
      });
      prisma.appeal.updateMany.mockImplementation(() => {
        order.push('close-appeal');
        return Promise.resolve({ count: 1 });
      });

      await service.decide(ADMIN_ID, APPEAL_ID, ACCEPT);

      expect(order).toEqual(['unsuspend', 'close-appeal']);
      expect(adminService.changeShopStatusInTx).toHaveBeenCalledWith(
        prisma,
        ADMIN_ID,
        SHOP_ID,
        { status: 'APPROVED' },
      );
    });

    it('đóng kháng nghị: chỉ khi còn PENDING, ghi Admin của PHIÊN, thời điểm và ghi chú (null nếu không có)', async () => {
      const { service, prisma } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, ACCEPT);

      expect(prisma.appeal.updateMany).toHaveBeenCalledWith({
        where: { id: APPEAL_ID, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          decidedById: ADMIN_ID,
          decidedAt: expect.any(Date) as unknown,
          decisionNote: null,
        },
      });
    });

    it('báo email + thông báo "shop được mở khoá" SAU commit rồi mới báo kết quả kháng nghị', async () => {
      const { service, prisma, adminService, notifications } = setup();
      const order: string[] = [];
      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => unknown) => {
          const out = await cb(prisma);
          order.push('commit');
          return out;
        },
      );
      adminService.announceShopStatusChange.mockImplementation(() => {
        order.push('announce-shop');
        return Promise.resolve({});
      });
      notifications.notify.mockImplementation((event) => {
        order.push(`notify:${event.kind}`);
        return Promise.resolve();
      });

      await service.decide(ADMIN_ID, APPEAL_ID, ACCEPT);

      expect(order).toEqual([
        'commit',
        'announce-shop',
        'notify:APPEAL_DECIDED',
      ]);
      expect(adminService.announceShopStatusChange).toHaveBeenCalledWith(
        ADMIN_ID,
        SHOP_ID,
        'SUSPENDED',
        { status: 'APPROVED' },
      );
    });

    it('thông báo kết quả là ACCEPTED và chỉ mang id (không mang ghi chú)', async () => {
      const { service, notifications } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, {
        decision: 'ACCEPT',
        note: 'Đã đủ giấy tờ',
      });

      expect(notifications.events).toEqual([
        {
          kind: 'APPEAL_DECIDED',
          appealId: APPEAL_ID,
          shopId: SHOP_ID,
          decision: 'ACCEPTED',
        },
      ]);
    });

    it('chủ shop đang bị khoá tài khoản (luật duyệt/mở khoá ném 409) ⇒ lỗi lan ra, kháng nghị KHÔNG bị đóng, không nhật ký, không thông báo', async () => {
      const { service, prisma, adminService, auditService, notifications } =
        setup();
      adminService.changeShopStatusInTx.mockRejectedValue(
        new AppException(
          409,
          'SHOP_OWNER_NOT_ACTIVE',
          'The shop owner account is not active',
        ),
      );

      await expectAppException(service.decide(ADMIN_ID, APPEAL_ID, ACCEPT), {
        status: 409,
        code: 'SHOP_OWNER_NOT_ACTIVE',
      });
      expect(prisma.appeal.updateMany).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(adminService.announceShopStatusChange).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('từ chối', () => {
    it('KHÔNG đụng trạng thái shop và không gửi email/thông báo "shop"', async () => {
      const { service, adminService } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
      expect(adminService.announceShopStatusChange).not.toHaveBeenCalled();
    });

    it('ghi REJECTED kèm ghi chú gửi lại chủ shop', async () => {
      const { service, prisma } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      expect(prisma.appeal.updateMany).toHaveBeenCalledWith({
        where: { id: APPEAL_ID, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: ADMIN_ID,
          decidedAt: expect.any(Date) as unknown,
          decisionNote: REJECT.note,
        },
      });
    });

    it('báo chủ shop kết quả REJECTED, chỉ mang id', async () => {
      const { service, notifications } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      expect(notifications.events).toEqual([
        {
          kind: 'APPEAL_DECIDED',
          appealId: APPEAL_ID,
          shopId: SHOP_ID,
          decision: 'REJECTED',
        },
      ]);
      expect(JSON.stringify(notifications.events)).not.toContain(REJECT.note);
    });
  });

  describe('nhật ký quản trị', () => {
    it('ghi DECIDE_APPEAL CÙNG giao dịch với đối tượng là KHÁNG NGHỊ, lý do là ghi chú, meta chỉ có quyết định + shop, kèm IP/User-Agent', async () => {
      const { service, prisma, auditService } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, REJECT, CONTEXT);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(prisma, {
        actorId: ADMIN_ID,
        action: 'DECIDE_APPEAL',
        targetType: 'APPEAL',
        targetId: APPEAL_ID,
        reason: REJECT.note,
        meta: { decision: 'REJECT', shopId: SHOP_ID },
        ip: CONTEXT.ip,
        userAgent: CONTEXT.userAgent,
      });
    });

    it('chấp nhận không ghi chú ⇒ mục nhật ký không có `reason`', async () => {
      const { service, auditService } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, ACCEPT);

      const [[, entry]] = auditService.record.mock.calls as [
        unknown,
        Record<string, unknown>,
      ][];
      expect(entry).not.toHaveProperty('reason');
      expect(entry.meta).toEqual({ decision: 'ACCEPT', shopId: SHOP_ID });
    });

    it('ghi nhật ký lỗi ⇒ quyết định rollback (lỗi lan ra), không email, không thông báo', async () => {
      const { service, auditService, adminService, notifications } = setup();
      auditService.record.mockRejectedValue(new Error('audit down'));

      await expect(service.decide(ADMIN_ID, APPEAL_ID, ACCEPT)).rejects.toThrow(
        'audit down',
      );
      expect(adminService.announceShopStatusChange).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('trọng tài cuối', () => {
    it('đã giữ khoá hàng mà UPDATE có điều kiện vẫn không khớp dòng nào ⇒ 409 và rollback, không ghi nhật ký', async () => {
      const { service, prisma, auditService, notifications } = setup();
      prisma.appeal.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(service.decide(ADMIN_ID, APPEAL_ID, ACCEPT), {
        status: 409,
        code: 'APPEAL_ALREADY_DECIDED',
      });
      expect(auditService.record).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('văn bản riêng tư', () => {
    const CANARY = 'CANARY-DECISION-NOTE';

    it('lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi ⇒ bị che, không còn canary trong lỗi ném ra', async () => {
      const { service, prisma } = setup();
      prisma.appeal.updateMany.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          `Invalid invocation: data: { decisionNote: "${CANARY}" }`,
          { clientVersion: 'test' },
        ),
      );

      const error = (await service
        .decide(ADMIN_ID, APPEAL_ID, { decision: 'REJECT', note: CANARY })
        .catch((e: unknown) => e)) as Error;

      expect(error.message).toContain('details omitted');
      expect(`${error.message}\n${error.stack}`).not.toContain(CANARY);
    });

    it('log chỉ có id và quyết định, không có ghi chú', async () => {
      const { service } = setup();

      await service.decide(ADMIN_ID, APPEAL_ID, {
        decision: 'REJECT',
        note: CANARY,
      });

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain(ADMIN_ID);
      expect(logged).toContain(APPEAL_ID);
      expect(logged).not.toContain(CANARY);
    });
  });

  // Kháng nghị sản phẩm bị gỡ (Week11.md 5.8): chấp nhận = khôi phục sản phẩm về NHÁP bằng đúng luật khôi phục của 5.7, cùng giao dịch.
  describe('kháng nghị sản phẩm', () => {
    async function expectUntouched(
      ctx: ReturnType<typeof setup>,
      code: string,
      dto: { decision: 'ACCEPT' | 'REJECT'; note?: string } = ACCEPT,
    ) {
      await expectAppException(ctx.service.decide(ADMIN_ID, APPEAL_ID, dto), {
        status: 409,
        code,
      });
      expect(ctx.productModeration.restoreInTx).not.toHaveBeenCalled();
      expect(ctx.prisma.appeal.updateMany).not.toHaveBeenCalled();
      expect(ctx.auditService.record).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    }

    it('khoá hàng sản phẩm bằng FOR UPDATE sau khi khoá hàng kháng nghị (không ai khôi phục rồi gỡ lại chen vào giữa)', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);

      await ctx.service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      const calls = ctx.prisma.$queryRaw.mock.calls as [Prisma.Sql][];
      expect(calls[0][0].text).toMatch(
        /FROM appeals WHERE id = \$1 FOR UPDATE/,
      );
      expect(calls[1][0].text).toMatch(
        /SELECT shop_id, status, taken_down_at FROM products WHERE id = \$1 FOR UPDATE/,
      );
      expect(calls[1][0].values).toEqual([PRODUCT_ID]);
    });

    it('chấp nhận: khôi phục sản phẩm TRONG cùng giao dịch, TRƯỚC khi đóng kháng nghị, không đụng trạng thái shop', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);
      const order: string[] = [];
      ctx.productModeration.restoreInTx.mockImplementation(() => {
        order.push('restore');
        return Promise.resolve();
      });
      ctx.prisma.appeal.updateMany.mockImplementation(() => {
        order.push('close-appeal');
        return Promise.resolve({ count: 1 });
      });

      await ctx.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT, CONTEXT);

      expect(order).toEqual(['restore', 'close-appeal']);
      expect(ctx.productModeration.restoreInTx).toHaveBeenCalledWith(
        ctx.prisma,
        { adminId: ADMIN_ID, productId: PRODUCT_ID, context: CONTEXT },
      );
      expect(ctx.adminService.changeShopStatusInTx).not.toHaveBeenCalled();
      expect(ctx.adminService.announceShopStatusChange).not.toHaveBeenCalled();
    });

    it('chấp nhận có ghi chú ⇒ ghi chú là lý do của dòng khôi phục; không ghi chú ⇒ không bịa lý do', async () => {
      const withNote = setup();
      mockProductAppeal(withNote);
      await withNote.service.decide(ADMIN_ID, APPEAL_ID, {
        decision: 'ACCEPT',
        note: 'Đã đủ giấy tờ',
      });
      expect(withNote.productModeration.restoreInTx).toHaveBeenCalledWith(
        withNote.prisma,
        expect.objectContaining({ reason: 'Đã đủ giấy tờ' }) as unknown,
      );

      const withoutNote = setup();
      mockProductAppeal(withoutNote);
      await withoutNote.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT);
      const [[, input]] = withoutNote.productModeration.restoreInTx.mock
        .calls as [unknown, Record<string, unknown>][];
      expect(input).not.toHaveProperty('reason');
    });

    it('từ chối: KHÔNG khôi phục, chỉ đóng kháng nghị REJECTED kèm ghi chú', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);

      await ctx.service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      expect(ctx.productModeration.restoreInTx).not.toHaveBeenCalled();
      expect(ctx.adminService.changeShopStatusInTx).not.toHaveBeenCalled();
      expect(ctx.prisma.appeal.updateMany).toHaveBeenCalledWith({
        where: { id: APPEAL_ID, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: ADMIN_ID,
          decidedAt: expect.any(Date) as unknown,
          decisionNote: REJECT.note,
        },
      });
    });

    it.each([
      ['chấp nhận', ACCEPT, 'ACCEPTED'],
      ['từ chối', REJECT, 'REJECTED'],
    ] as const)(
      '%s: báo chủ shop bằng PRODUCT_APPEAL_DECIDED SAU commit, chỉ mang id và kết quả (không ghi chú), không dùng thông báo của shop',
      async (_name, dto, decision) => {
        const ctx = setup();
        mockProductAppeal(ctx);
        const order: string[] = [];
        ctx.prisma.$transaction.mockImplementation(
          async (cb: (tx: unknown) => unknown) => {
            const out = await cb(ctx.prisma);
            order.push('commit');
            return out;
          },
        );
        ctx.notifications.notify.mockImplementation((event) => {
          order.push(`notify:${event.kind}`);
          ctx.notifications.events.push(event);
          return Promise.resolve();
        });

        await ctx.service.decide(ADMIN_ID, APPEAL_ID, dto);

        expect(order).toEqual(['commit', 'notify:PRODUCT_APPEAL_DECIDED']);
        expect(ctx.notifications.events).toEqual([
          {
            kind: 'PRODUCT_APPEAL_DECIDED',
            appealId: APPEAL_ID,
            productId: PRODUCT_ID,
            decision,
          },
        ]);
        expect(JSON.stringify(ctx.notifications.events)).not.toContain(
          REJECT.note,
        );
      },
    );

    it('nhật ký DECIDE_APPEAL cùng giao dịch: meta có quyết định + shop CỦA SẢN PHẨM + sản phẩm', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);

      await ctx.service.decide(ADMIN_ID, APPEAL_ID, REJECT, CONTEXT);

      expect(ctx.auditService.record).toHaveBeenCalledTimes(1);
      expect(ctx.auditService.record).toHaveBeenCalledWith(ctx.prisma, {
        actorId: ADMIN_ID,
        action: 'DECIDE_APPEAL',
        targetType: 'APPEAL',
        targetId: APPEAL_ID,
        reason: REJECT.note,
        meta: {
          decision: 'REJECT',
          shopId: SHOP_ID,
          productId: PRODUCT_ID,
        },
        ip: CONTEXT.ip,
        userAgent: CONTEXT.userAgent,
      });
    });

    it('sản phẩm đã được khôi phục bằng đường khác (không còn TAKEN_DOWN) ⇒ 409 APPEAL_TARGET_CHANGED, không đổi gì', async () => {
      const ctx = setup();
      mockProductAppeal(ctx, {
        locked: { status: 'DRAFT', taken_down_at: null },
      });

      await expectUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });

    it('sản phẩm bị gỡ lại một lần khác (mốc gỡ đã đổi) ⇒ 409: kháng nghị cũ không khôi phục được lần gỡ mới', async () => {
      const ctx = setup();
      mockProductAppeal(ctx, { locked: { taken_down_at: LATER_AT } });

      await expectUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });

    it('từ chối một kháng nghị đã hết hiệu lực cũng 409 (không tự đóng ngầm)', async () => {
      const ctx = setup();
      mockProductAppeal(ctx, { locked: { taken_down_at: LATER_AT } });

      await expectUntouched(ctx, 'APPEAL_TARGET_CHANGED', REJECT);
    });

    it('sản phẩm không còn (đã bị xoá) ⇒ 409 APPEAL_TARGET_CHANGED', async () => {
      const ctx = setup();
      ctx.prisma.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([
          lockedRow({ target_type: 'PRODUCT', target_id: PRODUCT_ID }),
        ])
        .mockResolvedValueOnce([]);

      await expectUntouched(ctx, 'APPEAL_TARGET_CHANGED');
    });

    it('đã có người quyết định trước ⇒ 409 APPEAL_ALREADY_DECIDED và KHÔNG khoá hàng sản phẩm', async () => {
      const ctx = setup();
      ctx.prisma.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([
          lockedRow({ target_type: 'PRODUCT', status: 'ACCEPTED' }),
        ]);

      await expectUntouched(ctx, 'APPEAL_ALREADY_DECIDED');
      expect(ctx.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('luật khôi phục của 5.7 ném 409 (vd Admin khác vừa khôi phục) ⇒ lỗi lan ra, kháng nghị KHÔNG bị đóng, không nhật ký, không thông báo', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);
      ctx.productModeration.restoreInTx.mockRejectedValue(
        new AppException(
          409,
          'PRODUCT_NOT_TAKEN_DOWN',
          'This product is not taken down',
        ),
      );

      await expectAppException(
        ctx.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT),
        { status: 409, code: 'PRODUCT_NOT_TAKEN_DOWN' },
      );
      expect(ctx.prisma.appeal.updateMany).not.toHaveBeenCalled();
      expect(ctx.auditService.record).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });

    it('đã giữ khoá hàng mà UPDATE có điều kiện vẫn không khớp ⇒ 409 và không nhật ký, không thông báo', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);
      ctx.prisma.appeal.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(
        ctx.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT),
        { status: 409, code: 'APPEAL_ALREADY_DECIDED' },
      );
      expect(ctx.auditService.record).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });

    it('ghi nhật ký lỗi ⇒ rollback (lỗi lan ra), không thông báo', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);
      ctx.auditService.record.mockRejectedValue(new Error('audit down'));

      await expect(
        ctx.service.decide(ADMIN_ID, APPEAL_ID, ACCEPT),
      ).rejects.toThrow('audit down');
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });

    it('log có id kháng nghị, sản phẩm và shop nhưng không có ghi chú', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);

      await ctx.service.decide(ADMIN_ID, APPEAL_ID, {
        decision: 'REJECT',
        note: 'CANARY-PRODUCT-NOTE',
      });

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain(APPEAL_ID);
      expect(logged).toContain(PRODUCT_ID);
      expect(logged).not.toContain('CANARY-PRODUCT-NOTE');
    });

    it('lỗi ghi của Prisma mang nguyên giá trị đã ghi ⇒ bị che, không còn canary', async () => {
      const ctx = setup();
      mockProductAppeal(ctx);
      ctx.prisma.appeal.updateMany.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          'Invalid invocation: data: { decisionNote: "CANARY-PRODUCT-NOTE" }',
          { clientVersion: 'test' },
        ),
      );

      const error = (await ctx.service
        .decide(ADMIN_ID, APPEAL_ID, {
          decision: 'REJECT',
          note: 'CANARY-PRODUCT-NOTE',
        })
        .catch((e: unknown) => e)) as Error;

      expect(`${error.message}\n${error.stack}`).not.toContain(
        'CANARY-PRODUCT-NOTE',
      );
    });

    it('trả kháng nghị sản phẩm sau khi quyết định, đúng hình dạng một dòng hàng đợi', async () => {
      const ctx = setup();
      mockProductAppeal(ctx, {
        appeal: {
          status: 'REJECTED',
          decidedById: ADMIN_ID,
          decisionNote: REJECT.note,
          decidedAt: LATER_AT,
        },
      });
      ctx.prisma.user.findMany.mockResolvedValue([
        { id: ADMIN_ID, name: 'Quản trị' },
      ]);

      const { appeal } = await ctx.service.decide(ADMIN_ID, APPEAL_ID, REJECT);

      expect(appeal).toMatchObject({
        id: APPEAL_ID,
        targetType: 'PRODUCT',
        state: 'REJECTED',
        decidedByName: 'Quản trị',
        product: { id: PRODUCT_ID, name: 'Dao bấm tự động' },
      });
    });
  });

  it('trả kháng nghị sau khi quyết định (đọc lại sau commit), đúng hình dạng một dòng hàng đợi', async () => {
    const { service, prisma } = setup();
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({
        status: 'REJECTED',
        decidedById: ADMIN_ID,
        decisionNote: REJECT.note,
        decidedAt: LATER_AT,
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, name: 'Quản trị' },
    ]);

    const { appeal } = await service.decide(ADMIN_ID, APPEAL_ID, REJECT);

    expect(appeal).toMatchObject({
      id: APPEAL_ID,
      state: 'REJECTED',
      decisionNote: REJECT.note,
      decidedByName: 'Quản trị',
      decidedAt: LATER_AT.toISOString(),
    });
  });
});
