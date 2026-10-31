import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeNotificationService,
  type FakeNotificationService,
} from '../../shared/testing/fake-notification-service';
import {
  AppealService,
  toOwnerAppeal,
  toOwnerProductAppeal,
} from './appeal.service';

// Logic không cần DB của AppealService (Week11.md 4.6 và 5.8): ai được kháng nghị khi nào, mốc bị xử lý lấy từ server, trọng tài khi hai
// lần gửi đụng nhau, và lời kháng nghị (văn bản riêng tư) không vào log hay lỗi. Khoá `FOR SHARE`, UNIQUE và CHECK thật trên
// Postgres do shop-appeal.controller.int-spec.ts và product-appeal.controller.int-spec.ts kiểm.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SHOP_ID = '55555555-5555-4555-8555-555555555555';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_AT = new Date('2026-10-28T10:00:00.000Z');
const LATER_AT = new Date('2026-10-29T10:00:00.000Z');

function appealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appeal-1',
    status: 'PENDING' as const,
    message: 'Shop đã gỡ hàng bị báo cáo',
    decisionNote: null,
    createdAt: new Date('2026-10-29T08:00:00.000Z'),
    decidedAt: null,
    moderationEventAt: EVENT_AT,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    shop: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    appeal: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    shopStatusHistory: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
  prisma.shop.findUnique.mockResolvedValue({
    status: 'SUSPENDED',
    statusChangedAt: EVENT_AT,
  });
  prisma.$queryRaw.mockResolvedValue([
    { status: 'SUSPENDED', status_changed_at: EVENT_AT },
  ]);
  prisma.shopStatusHistory.findFirst.mockResolvedValue({
    toStatus: 'SUSPENDED',
    actorType: 'ADMIN',
  });
  // Sản phẩm của SHOP_ID đang bị gỡ (dùng cho các ca kháng nghị sản phẩm; ca kháng nghị shop không chạm tới).
  prisma.product.findUnique.mockResolvedValue({
    shopId: SHOP_ID,
    status: 'TAKEN_DOWN',
    takenDownAt: EVENT_AT,
  });
  prisma.appeal.findMany.mockResolvedValue([]);
  prisma.appeal.findUnique.mockResolvedValue(null);
  prisma.appeal.create.mockResolvedValue(appealRow());
  const notifications: FakeNotificationService =
    createFakeNotificationService();
  const service = new AppealService(
    prisma as unknown as PrismaService,
    notifications,
  );
  return { service, prisma, notifications };
}

let log: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('toOwnerAppeal', () => {
  it('trả đúng bảy trường của allowlist, mốc thời gian dạng ISO, trạng thái suy ra từ lần khoá', () => {
    const shop = { status: 'SUSPENDED', statusChangedAt: EVENT_AT };

    expect(toOwnerAppeal(appealRow(), shop)).toEqual({
      id: 'appeal-1',
      state: 'PENDING',
      message: 'Shop đã gỡ hàng bị báo cáo',
      decisionNote: null,
      createdAt: '2026-10-29T08:00:00.000Z',
      decidedAt: null,
      moderationEventAt: '2026-10-28T10:00:00.000Z',
    });
  });

  it('hàng DB lỡ có thêm trường lạ (người quyết định, người kháng nghị) vẫn KHÔNG lọt vào response', () => {
    const leaky = appealRow({
      decidedById: 'admin-1',
      appellantId: USER_ID,
      targetId: SHOP_ID,
    });

    const result = toOwnerAppeal(leaky, {
      status: 'SUSPENDED',
      statusChangedAt: EVENT_AT,
    });

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'decidedAt',
      'decisionNote',
      'id',
      'message',
      'moderationEventAt',
      'state',
    ]);
  });

  it('kháng nghị còn PENDING nhưng shop đã được mở khoá ⇒ CLOSED; đã có kết quả thì giữ nguyên', () => {
    const approved = { status: 'APPROVED', statusChangedAt: LATER_AT };

    expect(toOwnerAppeal(appealRow(), approved).state).toBe('CLOSED');
    expect(
      toOwnerAppeal(
        appealRow({
          status: 'REJECTED',
          decisionNote: 'Chưa đủ',
          decidedAt: LATER_AT,
        }),
        approved,
      ).state,
    ).toBe('REJECTED');
  });
});

describe('AppealService.listForShop', () => {
  it('shop không tồn tại ⇒ 404', async () => {
    const { service, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(null);

    await expect(service.listForShop(SHOP_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('chỉ đọc kháng nghị của ĐÚNG shop, lần khoá mới nhất trước, tối đa 20', async () => {
    const { service, prisma } = setup();

    await service.listForShop(SHOP_ID);

    expect(prisma.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetType: 'SHOP', targetId: SHOP_ID },
        orderBy: { moderationEventAt: 'desc' },
        take: 20,
      }),
    );
  });

  it('shop bị Admin khoá và lần khoá này chưa có kháng nghị ⇒ canAppeal', async () => {
    const { service } = setup();

    await expect(service.listForShop(SHOP_ID)).resolves.toEqual({
      appeals: [],
      canAppeal: true,
    });
  });

  it('lần khoá này đã có kháng nghị ⇒ không kháng nghị nữa', async () => {
    const { service, prisma } = setup();
    prisma.appeal.findMany.mockResolvedValue([appealRow()]);

    const result = await service.listForShop(SHOP_ID);

    expect(result.canAppeal).toBe(false);
    expect(result.appeals[0].state).toBe('PENDING');
  });

  it('kháng nghị của lần khoá TRƯỚC không chặn lần khoá mới (mốc đã khác)', async () => {
    const { service, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue({
      status: 'SUSPENDED',
      statusChangedAt: LATER_AT,
    });
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({
        status: 'REJECTED',
        decisionNote: 'Chưa đủ',
        decidedAt: new Date('2026-10-28T12:00:00.000Z'),
      }),
    ]);

    const result = await service.listForShop(SHOP_ID);

    expect(result.canAppeal).toBe(true);
    expect(result.appeals[0].state).toBe('REJECTED');
  });

  it('khoá theo cascade tài khoản (dòng lịch sử do hệ thống ghi) ⇒ không kháng nghị được', async () => {
    const { service, prisma } = setup();
    prisma.shopStatusHistory.findFirst.mockResolvedValue({
      toStatus: 'SUSPENDED',
      actorType: 'SYSTEM',
    });

    expect((await service.listForShop(SHOP_ID)).canAppeal).toBe(false);
  });

  it.each(['APPROVED', 'PENDING', 'REJECTED'])(
    'shop %s ⇒ không kháng nghị được và không cần tra lịch sử',
    async (status) => {
      const { service, prisma } = setup();
      prisma.shop.findUnique.mockResolvedValue({
        status,
        statusChangedAt: EVENT_AT,
      });

      expect((await service.listForShop(SHOP_ID)).canAppeal).toBe(false);
      expect(prisma.shopStatusHistory.findFirst).not.toHaveBeenCalled();
    },
  );
});

describe('AppealService.create', () => {
  const DTO = { message: 'Shop đã gỡ hàng bị báo cáo' };

  it('ghi kháng nghị với người gửi từ phiên, shop từ đường dẫn và MỐC LẤY TỪ SERVER (cột status_changed_at đã khoá)', async () => {
    const { service, prisma } = setup();

    const result = await service.create(USER_ID, SHOP_ID, DTO);

    expect(prisma.appeal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          targetType: 'SHOP',
          targetId: SHOP_ID,
          appellantId: USER_ID,
          message: DTO.message,
          moderationEventAt: EVENT_AT,
        },
      }),
    );
    expect(result).toMatchObject({
      id: 'appeal-1',
      state: 'PENDING',
      moderationEventAt: EVENT_AT.toISOString(),
    });
  });

  it('khoá hàng shop bằng FOR SHARE trong giao dịch (Admin mở khoá cùng lúc phải chờ)', async () => {
    const { service, prisma } = setup();

    await service.create(USER_ID, SHOP_ID, DTO);

    const [[sql]] = prisma.$queryRaw.mock.calls as [Prisma.Sql][];
    expect(sql.text).toMatch(/FROM shops WHERE id = \$1 FOR SHARE/);
    expect(sql.values).toEqual([SHOP_ID]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('báo mọi Admin SAU khi giao dịch commit, chỉ mang id (không mang lời kháng nghị)', async () => {
    const { service, prisma, notifications } = setup();
    const order: string[] = [];
    prisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const out = await cb(prisma);
        order.push('commit');
        return out;
      },
    );
    notifications.notify.mockImplementation((event) => {
      order.push('notify');
      notifications.events.push(event);
      return Promise.resolve();
    });

    await service.create(USER_ID, SHOP_ID, DTO);

    expect(order).toEqual(['commit', 'notify']);
    expect(notifications.events).toEqual([
      { kind: 'APPEAL_SUBMITTED', appealId: 'appeal-1', shopId: SHOP_ID },
    ]);
    expect(JSON.stringify(notifications.events)).not.toContain(DTO.message);
  });

  it.each(['APPROVED', 'PENDING', 'REJECTED'])(
    'shop %s ⇒ 409 APPEAL_NOT_ALLOWED, không ghi gì, không báo ai',
    async (status) => {
      const { service, prisma, notifications } = setup();
      prisma.$queryRaw.mockResolvedValue([
        { status, status_changed_at: EVENT_AT },
      ]);

      await expectAppException(service.create(USER_ID, SHOP_ID, DTO), {
        status: 409,
        code: 'APPEAL_NOT_ALLOWED',
      });
      expect(prisma.appeal.create).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('khoá theo cascade tài khoản (không phải Admin khoá shop) ⇒ 409 APPEAL_NOT_ALLOWED', async () => {
    const { service, prisma } = setup();
    prisma.shopStatusHistory.findFirst.mockResolvedValue({
      toStatus: 'SUSPENDED',
      actorType: 'SYSTEM',
    });

    await expectAppException(service.create(USER_ID, SHOP_ID, DTO), {
      status: 409,
      code: 'APPEAL_NOT_ALLOWED',
    });
    expect(prisma.appeal.create).not.toHaveBeenCalled();
  });

  it('shop biến mất giữa chừng ⇒ 404', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.create(USER_ID, SHOP_ID, DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lần khoá này đã có kháng nghị ⇒ 409 APPEAL_ALREADY_SENT, không ghi thêm', async () => {
    const { service, prisma, notifications } = setup();
    prisma.appeal.findUnique.mockResolvedValue({ id: 'appeal-0' });

    await expectAppException(service.create(USER_ID, SHOP_ID, DTO), {
      status: 409,
      code: 'APPEAL_ALREADY_SENT',
    });
    expect(prisma.appeal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targetType_targetId_moderationEventAt: {
            targetType: 'SHOP',
            targetId: SHOP_ID,
            moderationEventAt: EVENT_AT,
          },
        },
      }),
    );
    expect(prisma.appeal.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  describe('đua với một lần gửi khác cùng lần khoá', () => {
    const uniqueError = (modelName: string) =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { modelName },
      });

    it('P2002 của chính bảng Appeal ⇒ 409 APPEAL_ALREADY_SENT (UNIQUE là trọng tài), không báo ai', async () => {
      const { service, prisma, notifications } = setup();
      prisma.appeal.create.mockRejectedValue(uniqueError('Appeal'));

      await expectAppException(service.create(USER_ID, SHOP_ID, DTO), {
        status: 409,
        code: 'APPEAL_ALREADY_SENT',
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('P2002 của model KHÁC không bị hiểu nhầm là "đã gửi": lỗi được ném nguyên', async () => {
      const { service, prisma } = setup();
      const other = uniqueError('Shop');
      prisma.appeal.create.mockRejectedValue(other);

      const error: unknown = await service
        .create(USER_ID, SHOP_ID, DTO)
        .catch((e: unknown) => e);

      expect(error).toBe(other);
      expect(error).not.toBeInstanceOf(AppException);
    });
  });

  describe('lời kháng nghị là văn bản riêng tư', () => {
    const CANARY = 'CANARY-APPEAL-TEXT';

    it('lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi ⇒ bị che, không còn canary trong lỗi ném ra', async () => {
      const { service, prisma } = setup();
      prisma.appeal.create.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          `Invalid invocation: data: { message: "${CANARY}" }`,
          { clientVersion: 'test' },
        ),
      );

      const error = (await service
        .create(USER_ID, SHOP_ID, { message: CANARY })
        .catch((e: unknown) => e)) as Error;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('details omitted');
      expect(`${error.message}\n${error.stack}`).not.toContain(CANARY);
    });

    it('log chỉ có id, không có nội dung lời kháng nghị', async () => {
      const { service } = setup();

      await service.create(USER_ID, SHOP_ID, { message: CANARY });

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain(USER_ID);
      expect(logged).toContain(SHOP_ID);
      expect(logged).not.toContain(CANARY);
    });
  });
});

// Kháng nghị sản phẩm bị gỡ (Week11.md 5.8).
describe('toOwnerProductAppeal', () => {
  it('cùng allowlist với kháng nghị shop, trạng thái suy ra từ lần gỡ', () => {
    const product = { status: 'TAKEN_DOWN', takenDownAt: EVENT_AT };

    const result = toOwnerProductAppeal(appealRow(), product);

    expect(result).toEqual({
      id: 'appeal-1',
      state: 'PENDING',
      message: 'Shop đã gỡ hàng bị báo cáo',
      decisionNote: null,
      createdAt: '2026-10-29T08:00:00.000Z',
      decidedAt: null,
      moderationEventAt: '2026-10-28T10:00:00.000Z',
    });
  });

  it('hàng DB lỡ có thêm trường lạ vẫn KHÔNG lọt vào response', () => {
    const result = toOwnerProductAppeal(
      appealRow({ decidedById: 'admin-1', appellantId: USER_ID }),
      { status: 'TAKEN_DOWN', takenDownAt: EVENT_AT },
    );

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'decidedAt',
      'decisionNote',
      'id',
      'message',
      'moderationEventAt',
      'state',
    ]);
  });

  it.each([
    ['sản phẩm đã khôi phục về nháp', { status: 'DRAFT', takenDownAt: null }],
    [
      'sản phẩm bị gỡ lại một lần khác (mốc đã đổi)',
      { status: 'TAKEN_DOWN', takenDownAt: LATER_AT },
    ],
  ])(
    'kháng nghị còn PENDING nhưng %s ⇒ CLOSED; đã có kết quả thì giữ nguyên',
    (_n, product) => {
      expect(toOwnerProductAppeal(appealRow(), product).state).toBe('CLOSED');
      expect(
        toOwnerProductAppeal(
          appealRow({ status: 'ACCEPTED', decidedAt: LATER_AT }),
          product,
        ).state,
      ).toBe('ACCEPTED');
    },
  );
});

describe('AppealService.listForProduct', () => {
  it('sản phẩm đang bị gỡ và lần gỡ này chưa có kháng nghị ⇒ canAppeal', async () => {
    const { service } = setup();

    await expect(service.listForProduct(SHOP_ID, PRODUCT_ID)).resolves.toEqual({
      appeals: [],
      canAppeal: true,
    });
  });

  it('chỉ đọc kháng nghị của ĐÚNG sản phẩm (targetType PRODUCT), lần gỡ mới nhất trước, tối đa 20', async () => {
    const { service, prisma } = setup();

    await service.listForProduct(SHOP_ID, PRODUCT_ID);

    expect(prisma.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetType: 'PRODUCT', targetId: PRODUCT_ID },
        orderBy: { moderationEventAt: 'desc' },
        take: 20,
      }),
    );
  });

  it('lần gỡ này đã có kháng nghị ⇒ không kháng nghị nữa', async () => {
    const { service, prisma } = setup();
    prisma.appeal.findMany.mockResolvedValue([appealRow()]);

    const result = await service.listForProduct(SHOP_ID, PRODUCT_ID);

    expect(result.canAppeal).toBe(false);
    expect(result.appeals[0].state).toBe('PENDING');
  });

  it('kháng nghị của lần gỡ TRƯỚC không chặn lần gỡ mới (mốc đã khác)', async () => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue({
      shopId: SHOP_ID,
      status: 'TAKEN_DOWN',
      takenDownAt: LATER_AT,
    });
    prisma.appeal.findMany.mockResolvedValue([
      appealRow({ status: 'REJECTED', decisionNote: 'Chưa đủ' }),
    ]);

    const result = await service.listForProduct(SHOP_ID, PRODUCT_ID);

    expect(result.canAppeal).toBe(true);
    expect(result.appeals[0].state).toBe('REJECTED');
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])(
    'sản phẩm %s (không bị gỡ) ⇒ không kháng nghị được',
    async (status) => {
      const { service, prisma } = setup();
      prisma.product.findUnique.mockResolvedValue({
        shopId: SHOP_ID,
        status,
        takenDownAt: null,
      });

      expect(
        (await service.listForProduct(SHOP_ID, PRODUCT_ID)).canAppeal,
      ).toBe(false);
    },
  );

  it('sản phẩm đã khôi phục: lịch sử vẫn hiện, kháng nghị đang chờ thành CLOSED, canAppeal false', async () => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue({
      shopId: SHOP_ID,
      status: 'DRAFT',
      takenDownAt: null,
    });
    prisma.appeal.findMany.mockResolvedValue([appealRow()]);

    const result = await service.listForProduct(SHOP_ID, PRODUCT_ID);

    expect(result.canAppeal).toBe(false);
    expect(result.appeals[0].state).toBe('CLOSED');
  });

  // Một 404 duy nhất cho mọi lý do không xem được: chủ shop không dò được sản phẩm của người khác.
  it.each([
    ['sản phẩm không tồn tại', null],
    [
      'sản phẩm thuộc shop khác',
      { shopId: OTHER_SHOP_ID, status: 'TAKEN_DOWN', takenDownAt: EVENT_AT },
    ],
  ])('%s ⇒ 404 và không đọc kháng nghị nào', async (_name, row) => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(row);

    await expect(
      service.listForProduct(SHOP_ID, PRODUCT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appeal.findMany).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '', `${PRODUCT_ID}\u0000`])(
    'id sản phẩm sai dạng (%j) ⇒ 404 mà không chạm DB',
    async (id) => {
      const { service, prisma } = setup();

      await expect(service.listForProduct(SHOP_ID, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
      expect(prisma.appeal.findMany).not.toHaveBeenCalled();
    },
  );
});

describe('AppealService.createForProduct', () => {
  const DTO = { message: 'Sản phẩm đã bổ sung giấy tờ nguồn gốc' };

  function lockedProduct(
    ctx: ReturnType<typeof setup>,
    overrides: Record<string, unknown> = {},
  ) {
    ctx.prisma.$queryRaw.mockResolvedValue([
      {
        shop_id: SHOP_ID,
        status: 'TAKEN_DOWN',
        taken_down_at: EVENT_AT,
        ...overrides,
      },
    ]);
  }

  it('ghi kháng nghị với người gửi từ phiên, sản phẩm từ đường dẫn và MỐC LẤY TỪ SERVER (cột taken_down_at đã khoá)', async () => {
    const ctx = setup();
    lockedProduct(ctx);

    const result = await ctx.service.createForProduct(
      USER_ID,
      SHOP_ID,
      PRODUCT_ID,
      DTO,
    );

    expect(ctx.prisma.appeal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          targetType: 'PRODUCT',
          targetId: PRODUCT_ID,
          appellantId: USER_ID,
          message: DTO.message,
          moderationEventAt: EVENT_AT,
        },
      }),
    );
    expect(result).toMatchObject({
      id: 'appeal-1',
      state: 'PENDING',
      moderationEventAt: EVENT_AT.toISOString(),
    });
  });

  it('khoá hàng sản phẩm bằng FOR SHARE trong giao dịch (Admin khôi phục cùng lúc phải chờ)', async () => {
    const ctx = setup();
    lockedProduct(ctx);

    await ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO);

    const [[sql]] = ctx.prisma.$queryRaw.mock.calls as [Prisma.Sql][];
    expect(sql.text).toMatch(/FROM products WHERE id = \$1 FOR SHARE/);
    expect(sql.values).toEqual([PRODUCT_ID]);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('báo mọi Admin SAU khi giao dịch commit, chỉ mang id (không mang lời kháng nghị)', async () => {
    const ctx = setup();
    lockedProduct(ctx);
    const order: string[] = [];
    ctx.prisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const out = await cb(ctx.prisma);
        order.push('commit');
        return out;
      },
    );
    ctx.notifications.notify.mockImplementation((event) => {
      order.push('notify');
      ctx.notifications.events.push(event);
      return Promise.resolve();
    });

    await ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO);

    expect(order).toEqual(['commit', 'notify']);
    expect(ctx.notifications.events).toEqual([
      {
        kind: 'PRODUCT_APPEAL_SUBMITTED',
        appealId: 'appeal-1',
        productId: PRODUCT_ID,
      },
    ]);
    expect(JSON.stringify(ctx.notifications.events)).not.toContain(DTO.message);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])(
    'sản phẩm %s (không bị gỡ) ⇒ 409 APPEAL_NOT_ALLOWED, không ghi gì, không báo ai',
    async (status) => {
      const ctx = setup();
      lockedProduct(ctx, { status, taken_down_at: null });

      await expectAppException(
        ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
        { status: 409, code: 'APPEAL_NOT_ALLOWED' },
      );
      expect(ctx.prisma.appeal.create).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    },
  );

  // CHECK ở DB đã bảo đảm "không TAKEN_DOWN ⇒ không có mốc gỡ", nhưng quyền kháng nghị không được dựa vào điều đó: trạng thái phải được kiểm
  // trực tiếp (dữ liệu lệch do sửa tay / migration lỗi không được mở đường kháng nghị cho sản phẩm đang bán).
  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])(
    'sản phẩm %s mà còn sót mốc gỡ (dữ liệu lệch) ⇒ vẫn 409 APPEAL_NOT_ALLOWED, không ghi gì',
    async (status) => {
      const ctx = setup();
      lockedProduct(ctx, { status, taken_down_at: EVENT_AT });

      await expectAppException(
        ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
        { status: 409, code: 'APPEAL_NOT_ALLOWED' },
      );
      expect(ctx.prisma.appeal.create).not.toHaveBeenCalled();
    },
  );

  it('TAKEN_DOWN nhưng thiếu mốc gỡ (CHECK ở DB không cho xảy ra) ⇒ vẫn từ chối thay vì ghi mốc rỗng', async () => {
    const ctx = setup();
    lockedProduct(ctx, { taken_down_at: null });

    await expectAppException(
      ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
      { status: 409, code: 'APPEAL_NOT_ALLOWED' },
    );
    expect(ctx.prisma.appeal.create).not.toHaveBeenCalled();
  });

  it('sản phẩm của shop KHÁC ⇒ cùng một 404 như sản phẩm không tồn tại, không ghi gì', async () => {
    const ctx = setup();
    lockedProduct(ctx, { shop_id: OTHER_SHOP_ID });

    await expect(
      ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.appeal.create).not.toHaveBeenCalled();
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });

  it('sản phẩm không tồn tại ⇒ 404', async () => {
    const ctx = setup();
    ctx.prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['not-a-uuid', '', `${PRODUCT_ID}\u0000`])(
    'id sản phẩm sai dạng (%j) ⇒ 404 mà không mở giao dịch',
    async (id) => {
      const ctx = setup();

      await expect(
        ctx.service.createForProduct(USER_ID, SHOP_ID, id, DTO),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('lần gỡ này đã có kháng nghị ⇒ 409 APPEAL_ALREADY_SENT, không ghi thêm', async () => {
    const ctx = setup();
    lockedProduct(ctx);
    ctx.prisma.appeal.findUnique.mockResolvedValue({ id: 'appeal-0' });

    await expectAppException(
      ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
      { status: 409, code: 'APPEAL_ALREADY_SENT' },
    );
    expect(ctx.prisma.appeal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targetType_targetId_moderationEventAt: {
            targetType: 'PRODUCT',
            targetId: PRODUCT_ID,
            moderationEventAt: EVENT_AT,
          },
        },
      }),
    );
    expect(ctx.prisma.appeal.create).not.toHaveBeenCalled();
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });

  describe('đua với một lần gửi khác cùng lần gỡ', () => {
    const uniqueError = (modelName: string) =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { modelName },
      });

    it('P2002 của chính bảng Appeal ⇒ 409 APPEAL_ALREADY_SENT (UNIQUE là trọng tài), không báo ai', async () => {
      const ctx = setup();
      lockedProduct(ctx);
      ctx.prisma.appeal.create.mockRejectedValue(uniqueError('Appeal'));

      await expectAppException(
        ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO),
        { status: 409, code: 'APPEAL_ALREADY_SENT' },
      );
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });

    it('P2002 của model KHÁC không bị hiểu nhầm là "đã gửi": lỗi được ném nguyên', async () => {
      const ctx = setup();
      lockedProduct(ctx);
      const other = uniqueError('Product');
      ctx.prisma.appeal.create.mockRejectedValue(other);

      const error: unknown = await ctx.service
        .createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, DTO)
        .catch((e: unknown) => e);

      expect(error).toBe(other);
      expect(error).not.toBeInstanceOf(AppException);
    });
  });

  describe('lời kháng nghị là văn bản riêng tư', () => {
    const CANARY = 'CANARY-PRODUCT-APPEAL-TEXT';

    it('lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi ⇒ bị che, không còn canary trong lỗi ném ra', async () => {
      const ctx = setup();
      lockedProduct(ctx);
      ctx.prisma.appeal.create.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          `Invalid invocation: data: { message: "${CANARY}" }`,
          { clientVersion: 'test' },
        ),
      );

      const error = (await ctx.service
        .createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, { message: CANARY })
        .catch((e: unknown) => e)) as Error;

      expect(error.message).toContain('details omitted');
      expect(`${error.message}\n${error.stack}`).not.toContain(CANARY);
    });

    it('log chỉ có id người gửi, shop và sản phẩm, không có nội dung lời kháng nghị', async () => {
      const ctx = setup();
      lockedProduct(ctx);

      await ctx.service.createForProduct(USER_ID, SHOP_ID, PRODUCT_ID, {
        message: CANARY,
      });

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain(USER_ID);
      expect(logged).toContain(SHOP_ID);
      expect(logged).toContain(PRODUCT_ID);
      expect(logged).not.toContain(CANARY);
    });
  });
});
