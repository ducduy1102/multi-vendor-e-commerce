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

// Logic không cần DB của AdminAppealsService (Week11.md 4.6): bộ lọc/thứ tự của hàng đợi, ánh xạ response không lộ gì ngoài
// allowlist, và luồng quyết định — thứ tự các bước, tính nguyên tử (chấp nhận + đóng kháng nghị + nhật ký cùng giao dịch), việc
// gửi thông báo/email chỉ SAU commit. Khoá hàng, trọng tài đua giữa hai Admin và CHECK thật trên Postgres do
// admin-appeals.controller.int-spec.ts kiểm.
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const APPEAL_ID = '22222222-2222-4222-8222-222222222222';
const SHOP_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_AT = new Date('2026-10-28T10:00:00.000Z');
const LATER_AT = new Date('2026-10-29T10:00:00.000Z');

function appealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPEAL_ID,
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

function setup() {
  const prisma = {
    appeal: { findMany: jest.fn(), updateMany: jest.fn() },
    shop: { findMany: jest.fn(), findUnique: jest.fn() },
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
  prisma.user.findMany.mockResolvedValue([]);

  const adminService = {
    changeShopStatusInTx: jest.fn().mockResolvedValue('SUSPENDED'),
    announceShopStatusChange: jest.fn().mockResolvedValue({}),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications: FakeNotificationService =
    createFakeNotificationService();
  const service = new AdminAppealsService(
    prisma as unknown as PrismaService,
    adminService as unknown as AdminService,
    auditService,
    notifications,
  );
  return { service, prisma, adminService, auditService, notifications };
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

  it('PENDING: còn chờ VÀ lần khoá còn diễn ra, cũ nhất trước (id là khoá phụ)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, [APPEAL_ID]);

    await service.list(QUERY);

    for (const index of [0, 1]) {
      expect(sqlOf(prisma, index).text).toContain(
        `a.status = 'PENDING' AND s.status = 'SUSPENDED' AND s.status_changed_at = a.moderation_event_at`,
      );
    }
    expect(sqlOf(prisma, 1).text).toContain(
      'ORDER BY a.created_at ASC, a.id ASC',
    );
  });

  it('CLOSED: còn PENDING nhưng lần khoá đã kết thúc (shop không còn SUSPENDED hoặc mốc đã đổi), mới nhất trước', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, []);

    await service.list({ ...QUERY, status: 'CLOSED' });

    expect(sqlOf(prisma, 1).text).toContain(
      `a.status = 'PENDING' AND (s.status <> 'SUSPENDED' OR s.status_changed_at <> a.moderation_event_at)`,
    );
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

  it('luôn giới hạn đối tượng là SHOP và phân trang bằng tham số (không ghép chuỗi)', async () => {
    const { service, prisma } = setup();
    mockIds(prisma, []);

    await service.list({ ...QUERY, page: 3, limit: 20 });

    const page = sqlOf(prisma, 1);
    expect(page.text).toContain("a.target_type = 'SHOP'");
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
      'shop',
      'state',
    ]);
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

    it('kháng nghị sản phẩm (chưa có luồng quyết định) ⇒ cùng một 404, không đụng shop nào', async () => {
      const { service, prisma, adminService } = setup();
      prisma.$queryRaw.mockResolvedValue([
        lockedRow({ target_type: 'PRODUCT' }),
      ]);

      await expectAppException(service.decide(ADMIN_ID, APPEAL_ID, ACCEPT), {
        status: 404,
        code: 'APPEAL_NOT_FOUND',
      });
      expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
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
