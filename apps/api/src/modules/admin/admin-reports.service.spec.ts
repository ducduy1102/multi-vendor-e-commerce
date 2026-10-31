import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeNotificationService,
  type FakeNotificationService,
} from '../../shared/testing/fake-notification-service';
import type { ProductModerationService } from '../product/product-moderation.service';
import type { ReviewService } from '../review/review.service';
import type { AdminUserStatusService } from './admin-user-status.service';
import type { AdminService } from './admin.service';
import { AdminReportsService, toAdminReport } from './admin-reports.service';

// Logic không cần DB của AdminReportsService (Week11.md 5.4): thứ tự các bước trong giao dịch, xử lý theo ĐỐI TƯỢNG (đóng hết báo
// cáo mở cùng đối tượng, hành động chạy một lần), hành động chưa có bộ xử lý, "đã áp dụng", thông báo chỉ sau commit, và ghi chú
// (văn bản riêng tư) không vào log. Khoá tư vấn, khoá hàng, CHECK và luồng thật trên Postgres do admin-reports.controller.int-spec.ts kiểm.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';
const SIBLING = '33333333-3333-4333-8333-333333333333';
const SHOP = '44444444-4444-4444-8444-444444444444';
const BUYER = '55555555-5555-4555-8555-555555555555';
const OWNER = '66666666-6666-4666-8666-666666666666';
const CREATED = new Date('2026-10-31T08:00:00.000Z');
const NOTE = 'Bán hàng nhái, đã có nhiều báo cáo';

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT,
    targetType: 'SHOP' as const,
    targetId: SHOP,
    status: 'OPEN' as const,
    reasonCode: 'COUNTERFEIT',
    note: 'Hàng nhái',
    snapshot: { name: 'Shop A', slug: 'shop-a' } as Prisma.JsonValue,
    reporterId: BUYER,
    resolvedById: null as string | null,
    resolutionAction: null as string | null,
    resolutionNote: null as string | null,
    resolvedAt: null as Date | null,
    createdAt: CREATED,
    ...overrides,
  };
}

function setup() {
  const calls: string[] = [];
  const prisma = {
    report: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    shop: { findUnique: jest.fn() },
    review: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => {
    calls.push('tx:begin');
    return cb(prisma);
  });
  prisma.$executeRaw.mockImplementation(() => {
    calls.push('lock');
    return Promise.resolve(1);
  });
  prisma.$queryRaw.mockImplementation(() => {
    calls.push('select-for-update');
    return Promise.resolve([
      { status: 'OPEN', snapshot: { name: 'Shop A', slug: 'shop-a' } },
    ]);
  });
  prisma.report.findUnique.mockResolvedValue({
    targetType: 'SHOP',
    targetId: SHOP,
  });
  prisma.report.findMany.mockImplementation(
    (args: { where: { status?: string; id?: unknown } }) => {
      if (args.where.status === 'OPEN') {
        calls.push('find-open');
        return Promise.resolve([{ id: REPORT }, { id: SIBLING }]);
      }
      return Promise.resolve([
        reportRow({
          status: 'RESOLVED',
          resolvedById: ADMIN,
          resolutionAction: 'SUSPEND_SHOP',
          resolutionNote: NOTE,
          resolvedAt: CREATED,
        }),
      ]);
    },
  );
  prisma.report.updateMany.mockImplementation(() => {
    calls.push('close');
    return Promise.resolve({ count: 2 });
  });
  prisma.report.groupBy.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([
    { id: BUYER, name: 'Người báo', email: 'reporter@example.com' },
    { id: ADMIN, name: 'Quản trị viên', email: 'admin@example.com' },
  ]);
  prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

  const adminService = {
    changeShopStatusInTx: jest.fn().mockImplementation(() => {
      calls.push('suspend-shop');
      return Promise.resolve('APPROVED');
    }),
    announceShopStatusChange: jest.fn().mockResolvedValue(undefined),
  };
  const userStatusService = {
    changeStatusInTx: jest.fn().mockImplementation(() => {
      calls.push('suspend-user');
      return Promise.resolve({ user: {}, from: 'ACTIVE' });
    }),
    announceStatusChange: jest.fn().mockResolvedValue(undefined),
  };
  const reviewService = {
    hideInTx: jest.fn().mockImplementation(() => {
      calls.push('hide-review');
      return Promise.resolve({ productId: SHOP, hiddenAt: CREATED });
    }),
    announceHidden: jest.fn().mockResolvedValue(undefined),
  };
  prisma.review.findUnique.mockResolvedValue({ hiddenAt: null });
  const productModeration = {
    takeDownInTx: jest.fn().mockImplementation(() => {
      calls.push('take-down-product');
      return Promise.resolve({ takenDownAt: CREATED });
    }),
    announceTakenDown: jest.fn().mockResolvedValue(undefined),
  };
  prisma.product.findUnique.mockResolvedValue({ status: 'PUBLISHED' });
  const audit = {
    record: jest.fn().mockImplementation(() => {
      calls.push('audit');
      return Promise.resolve();
    }),
  };
  const notifications: FakeNotificationService =
    createFakeNotificationService();
  const service = new AdminReportsService(
    prisma as unknown as PrismaService,
    adminService as unknown as AdminService,
    userStatusService as unknown as AdminUserStatusService,
    reviewService as unknown as ReviewService,
    productModeration as unknown as ProductModerationService,
    audit,
    notifications,
  );
  return {
    service,
    prisma,
    adminService,
    userStatusService,
    reviewService,
    productModeration,
    audit,
    notifications,
    calls,
  };
}

let log: jest.SpyInstance;
let logError: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('toAdminReport', () => {
  const reporter = { name: 'Người báo', email: 'reporter@example.com' };

  it('trả đúng allowlist: người báo chỉ tên + email, người xử lý chỉ tên, ảnh chụp theo loại', () => {
    const result = toAdminReport(reportRow(), reporter, null, 3);

    expect(result).toEqual({
      id: REPORT,
      targetType: 'SHOP',
      targetId: SHOP,
      status: 'OPEN',
      reasonCode: 'COUNTERFEIT',
      note: 'Hàng nhái',
      reporter,
      createdAt: '2026-10-31T08:00:00.000Z',
      resolution: null,
      sameTargetOpenCount: 3,
      snapshot: { name: 'Shop A', slug: 'shop-a' },
    });
  });

  it('hàng DB lỡ có thêm trường lạ / người báo có thêm SĐT vẫn KHÔNG lọt vào response', () => {
    const leaky = reportRow({
      resolvedById: ADMIN,
      internalSecret: 'x',
    });

    const result = toAdminReport(
      leaky,
      { ...reporter, phone: '0901234567' } as typeof reporter,
      null,
      0,
    );

    const text = JSON.stringify(result);
    expect(text).not.toMatch(
      /internalSecret|0901234567|resolvedById|reporterId/,
    );
  });

  it('kết quả xử lý có người xử lý theo TÊN (không id)', () => {
    const result = toAdminReport(
      reportRow({
        status: 'RESOLVED',
        resolvedById: ADMIN,
        resolutionAction: 'SUSPEND_SHOP',
        resolutionNote: NOTE,
        resolvedAt: new Date('2026-10-31T09:00:00.000Z'),
      }),
      reporter,
      'Quản trị viên',
      0,
    );

    expect(result?.resolution).toEqual({
      action: 'SUSPEND_SHOP',
      note: NOTE,
      resolvedByName: 'Quản trị viên',
      resolvedAt: '2026-10-31T09:00:00.000Z',
    });
  });

  it('thiếu tài khoản người báo ⇒ dấu gạch thay vì làm hỏng', () => {
    expect(toAdminReport(reportRow(), undefined, null, 0)?.reporter).toEqual({
      name: '—',
      email: '—',
    });
  });

  it('ảnh chụp sai hình dạng của loại ⇒ null (nơi gọi bỏ qua và ghi log)', () => {
    expect(
      toAdminReport(reportRow({ snapshot: { oops: true } }), reporter, null, 0),
    ).toBeNull();
    expect(
      toAdminReport(
        reportRow({
          targetType: 'REVIEW',
          snapshot: { name: 'Shop A', slug: 'a' },
        }),
        reporter,
        null,
        0,
      ),
    ).toBeNull();
  });
});

describe('resolve — luồng thành công', () => {
  it('thứ tự trong giao dịch: khoá đối tượng → khoá hàng → hành động → tìm báo cáo mở → đóng → nhật ký', async () => {
    const { service, calls } = setup();

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    expect(calls).toEqual([
      'tx:begin',
      'lock',
      'select-for-update',
      'suspend-shop',
      'find-open',
      'close',
      'audit',
    ]);
  });

  it('khoá theo ĐỐI TƯỢNG (loại + id), không theo id báo cáo', async () => {
    const { service, prisma } = setup();

    await service.resolve(ADMIN, REPORT, { action: 'DISMISS' });

    const lockKey = String((prisma.$executeRaw.mock.calls[0] as unknown[])[1]);
    expect(lockKey).toBe(`report-target:SHOP:${SHOP}`);
  });

  it('đóng MỌI báo cáo mở của đối tượng cùng hành động, kết quả và ghi chú; hành động chạy đúng MỘT lần', async () => {
    const { service, prisma, adminService } = setup();

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    expect(adminService.changeShopStatusInTx).toHaveBeenCalledTimes(1);
    expect(prisma.report.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [REPORT, SIBLING] }, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedById: ADMIN,
        resolvedAt: expect.any(Date) as Date,
        resolutionAction: 'SUSPEND_SHOP',
        resolutionNote: NOTE,
      },
    });
  });

  it('khoá shop truyền lý do là ghi chú của Admin, qua đúng luật đổi trạng thái shop', async () => {
    const { service, adminService } = setup();

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    expect(adminService.changeShopStatusInTx).toHaveBeenCalledWith(
      expect.anything(),
      ADMIN,
      SHOP,
      { status: 'SUSPENDED', reason: NOTE },
    );
  });

  it('DISMISS: không chạy hành động nào, trạng thái DISMISSED, ghi chú tuỳ chọn lưu NULL', async () => {
    const { service, prisma, adminService, userStatusService } = setup();

    await service.resolve(ADMIN, REPORT, { action: 'DISMISS' });

    expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
    expect(userStatusService.changeStatusInTx).not.toHaveBeenCalled();
    expect(prisma.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISMISSED',
          resolutionAction: 'DISMISS',
          resolutionNote: null,
        }) as unknown,
      }),
    );
  });

  it('ghi MỘT dòng nhật ký RESOLVE_REPORT lên báo cáo vừa xử lý, lý do là ghi chú, meta chỉ có mã/số/cờ (không người báo)', async () => {
    const { service, audit } = setup();

    await service.resolve(
      ADMIN,
      REPORT,
      { action: 'SUSPEND_SHOP', note: NOTE },
      { ip: '203.0.113.7' },
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), {
      actorId: ADMIN,
      action: 'RESOLVE_REPORT',
      targetType: 'REPORT',
      targetId: REPORT,
      reason: NOTE,
      meta: {
        action: 'SUSPEND_SHOP',
        targetType: 'SHOP',
        targetId: SHOP,
        closedReports: 2,
        alreadyApplied: false,
      },
      ip: '203.0.113.7',
    });
  });

  it('báo mỗi người báo SAU commit, chỉ bằng id các báo cáo đã đóng', async () => {
    const { service, notifications, prisma } = setup();

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    expect(notifications.events).toEqual([
      { kind: 'REPORTS_RESOLVED', reportIds: [REPORT, SIBLING] },
    ]);
    expect(prisma.report.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      notifications.notify.mock.invocationCallOrder[0],
    );
  });

  it('hiệu ứng sau commit của hành động (email/thông báo shop) chạy SAU giao dịch; nó lỗi thì request vẫn thành công', async () => {
    const { service, adminService } = setup();
    adminService.announceShopStatusChange.mockRejectedValue(
      new Error('mail down'),
    );

    await expect(
      service.resolve(ADMIN, REPORT, { action: 'SUSPEND_SHOP', note: NOTE }),
    ).resolves.toBeDefined();

    expect(adminService.announceShopStatusChange).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
  });

  it('log chỉ có id và hành động — không có ghi chú của Admin hay của người báo', async () => {
    const { service } = setup();

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    const lines = log.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines.join('\n')).toContain(REPORT);
    expect(lines.join('\n')).not.toContain('nhái');
    expect(lines.join('\n')).not.toContain('Hàng nhái');
  });
});

describe('resolve — ẩn đánh giá (5.5)', () => {
  function reviewSetup() {
    const ctx = setup();
    ctx.prisma.report.findUnique.mockResolvedValue({
      targetType: 'REVIEW',
      targetId: SHOP,
    });
    ctx.prisma.$queryRaw.mockResolvedValue([
      {
        status: 'OPEN',
        snapshot: {
          productId: SHOP,
          productName: 'Áo',
          rating: 1,
          comment: 'Tệ',
          authorName: 'A',
        },
      },
    ]);
    return ctx;
  }

  it('gọi đúng luật ẩn của ReviewService TRONG giao dịch đóng báo cáo, lý do là ghi chú, rồi báo tác giả SAU commit', async () => {
    const { service, reviewService, calls, prisma } = reviewSetup();

    await service.resolve(
      ADMIN,
      REPORT,
      { action: 'HIDE_REVIEW', note: NOTE },
      { ip: '203.0.113.7' },
    );

    expect(reviewService.hideInTx).toHaveBeenCalledWith(expect.anything(), {
      adminId: ADMIN,
      reviewId: SHOP,
      reason: NOTE,
      context: { ip: '203.0.113.7' },
    });
    expect(calls.indexOf('hide-review')).toBeLessThan(calls.indexOf('close'));
    expect(reviewService.announceHidden).toHaveBeenCalledWith(SHOP);
    expect(prisma.report.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reviewService.announceHidden.mock.invocationCallOrder[0],
    );
  });

  it('đánh giá đã bị ẩn từ trước ⇒ không ẩn lại, không báo tác giả lần nữa, báo cáo vẫn đóng', async () => {
    const { service, prisma, reviewService } = reviewSetup();
    prisma.review.findUnique.mockResolvedValue({ hiddenAt: CREATED });

    await service.resolve(ADMIN, REPORT, { action: 'HIDE_REVIEW', note: NOTE });

    expect(reviewService.hideInTx).not.toHaveBeenCalled();
    expect(reviewService.announceHidden).not.toHaveBeenCalled();
    expect(prisma.report.updateMany).toHaveBeenCalled();
  });

  it('đánh giá không còn tồn tại ⇒ 409 REPORT_ACTION_NOT_ALLOWED, báo cáo vẫn mở', async () => {
    const { service, prisma } = reviewSetup();
    prisma.review.findUnique.mockResolvedValue(null);

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'HIDE_REVIEW', note: NOTE }),
      { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
    );

    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });
});

describe('resolve — gỡ sản phẩm (5.7)', () => {
  function productSetup() {
    const ctx = setup();
    ctx.prisma.report.findUnique.mockResolvedValue({
      targetType: 'PRODUCT',
      targetId: SHOP,
    });
    ctx.prisma.$queryRaw.mockResolvedValue([
      {
        status: 'OPEN',
        snapshot: { name: 'Dao bấm tự động', shopName: 'Tạp hoá A' },
      },
    ]);
    return ctx;
  }

  it('gọi đúng luật gỡ của ProductModerationService TRONG giao dịch đóng báo cáo, lý do là ghi chú, rồi báo chủ shop SAU commit', async () => {
    const { service, productModeration, calls, prisma } = productSetup();

    await service.resolve(
      ADMIN,
      REPORT,
      { action: 'TAKE_DOWN_PRODUCT', note: NOTE },
      { ip: '203.0.113.7' },
    );

    expect(productModeration.takeDownInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        adminId: ADMIN,
        productId: SHOP,
        reason: NOTE,
        context: { ip: '203.0.113.7' },
      },
    );
    expect(calls.indexOf('take-down-product')).toBeLessThan(
      calls.indexOf('close'),
    );
    expect(productModeration.announceTakenDown).toHaveBeenCalledWith(
      SHOP,
      NOTE,
    );
    expect(prisma.report.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      productModeration.announceTakenDown.mock.invocationCallOrder[0],
    );
  });

  it('sản phẩm đã bị gỡ từ trước ⇒ không gỡ lại, không báo chủ shop lần nữa, báo cáo vẫn đóng', async () => {
    const { service, prisma, productModeration } = productSetup();
    prisma.product.findUnique.mockResolvedValue({ status: 'TAKEN_DOWN' });

    await service.resolve(ADMIN, REPORT, {
      action: 'TAKE_DOWN_PRODUCT',
      note: NOTE,
    });

    expect(productModeration.takeDownInTx).not.toHaveBeenCalled();
    expect(productModeration.announceTakenDown).not.toHaveBeenCalled();
    expect(prisma.report.updateMany).toHaveBeenCalled();
  });

  it('sản phẩm không còn tồn tại ⇒ 409 REPORT_ACTION_NOT_ALLOWED, báo cáo vẫn mở', async () => {
    const { service, prisma } = productSetup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expectAppException(
      service.resolve(ADMIN, REPORT, {
        action: 'TAKE_DOWN_PRODUCT',
        note: NOTE,
      }),
      { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
    );

    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it('luật gỡ ném lỗi (vd Admin khác vừa gỡ qua route trực tiếp) ⇒ lỗi đó được trả nguyên, báo cáo không đóng, không báo ai', async () => {
    const { service, prisma, productModeration, notifications } =
      productSetup();
    productModeration.takeDownInTx.mockRejectedValue(
      new AppException(409, 'PRODUCT_ALREADY_TAKEN_DOWN', 'already'),
    );

    await expectAppException(
      service.resolve(ADMIN, REPORT, {
        action: 'TAKE_DOWN_PRODUCT',
        note: NOTE,
      }),
      { status: 409, code: 'PRODUCT_ALREADY_TAKEN_DOWN' },
    );

    expect(prisma.report.updateMany).not.toHaveBeenCalled();
    expect(productModeration.announceTakenDown).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('hành động chỉ hợp lệ cho loại khác (HIDE_REVIEW trên báo cáo sản phẩm) ⇒ 409 và không gỡ gì', async () => {
    const { service, productModeration } = productSetup();

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'HIDE_REVIEW', note: NOTE }),
      { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
    );

    expect(productModeration.takeDownInTx).not.toHaveBeenCalled();
  });
});

describe('resolve — đã áp dụng', () => {
  it('shop đã bị khoá từ trước: không khoá lại, vẫn đóng báo cáo là ĐÃ XỬ LÝ, nhật ký ghi alreadyApplied', async () => {
    const { service, prisma, adminService, audit } = setup();
    prisma.shop.findUnique.mockResolvedValue({ status: 'SUSPENDED' });

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_SHOP',
      note: NOTE,
    });

    expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
    expect(prisma.report.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({ alreadyApplied: true }) as unknown,
      }),
    );
  });
});

describe('resolve — hội thoại', () => {
  function conversationSetup(reporterRole: 'BUYER' | 'SHOP') {
    const ctx = setup();
    ctx.prisma.report.findUnique.mockResolvedValue({
      targetType: 'CONVERSATION',
      targetId: SHOP,
    });
    ctx.prisma.$queryRaw.mockResolvedValue([
      {
        status: 'OPEN',
        snapshot: { shopName: 'Shop A', buyerName: 'B', reporterRole },
      },
    ]);
    ctx.prisma.conversation.findUnique.mockResolvedValue({
      buyerId: BUYER,
      shop: { ownerId: OWNER },
    });
    ctx.prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      accountStatus: 'ACTIVE',
    });
    return ctx;
  }

  it.each([
    ['BUYER', OWNER],
    ['SHOP', BUYER],
  ] as const)(
    'người báo là %s ⇒ khoá tài khoản của BÊN CÒN LẠI',
    async (reporterRole, expectedUser) => {
      const { service, userStatusService } = conversationSetup(reporterRole);

      await service.resolve(ADMIN, REPORT, {
        action: 'SUSPEND_REPORTED_USER',
        note: NOTE,
      });

      expect(userStatusService.changeStatusInTx).toHaveBeenCalledWith(
        expect.anything(),
        {
          adminId: ADMIN,
          userId: expectedUser,
          to: 'SUSPENDED',
          reason: NOTE,
          context: {},
        },
      );
    },
  );

  it('chủ thể đã bị khoá/cấm từ trước ⇒ không khoá lại, vẫn đóng báo cáo', async () => {
    const { service, prisma, userStatusService } = conversationSetup('BUYER');
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      accountStatus: 'BANNED',
    });

    await service.resolve(ADMIN, REPORT, {
      action: 'SUSPEND_REPORTED_USER',
      note: NOTE,
    });

    expect(userStatusService.changeStatusInTx).not.toHaveBeenCalled();
    expect(prisma.report.updateMany).toHaveBeenCalled();
  });

  it('chủ thể là Admin KHÔNG được coi là "đã xử lý": luật khoá tài khoản chặn bằng lỗi của nó', async () => {
    const { service, prisma, userStatusService } = conversationSetup('BUYER');
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    userStatusService.changeStatusInTx.mockRejectedValue(
      new AppException(409, 'CANNOT_MODIFY_ADMIN', 'no'),
    );

    await expectAppException(
      service.resolve(ADMIN, REPORT, {
        action: 'SUSPEND_REPORTED_USER',
        note: NOTE,
      }),
      { status: 409, code: 'CANNOT_MODIFY_ADMIN' },
    );

    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it('BLOCK_BUYER khi bên bị báo là chủ shop (người mua báo) ⇒ 409 REPORT_ACTION_NOT_ALLOWED, không đóng gì', async () => {
    const { service, prisma } = conversationSetup('BUYER');

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'BLOCK_BUYER', note: NOTE }),
      { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
    );

    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });
});

describe('resolve — từ chối', () => {
  it('id sai dạng ⇒ 404 REPORT_NOT_FOUND và không mở giao dịch', async () => {
    const { service, prisma } = setup();

    await expectAppException(
      service.resolve(ADMIN, 'not-a-uuid', { action: 'DISMISS' }),
      { status: 404, code: 'REPORT_NOT_FOUND' },
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('báo cáo không tồn tại ⇒ 404', async () => {
    const { service, prisma } = setup();
    prisma.report.findUnique.mockResolvedValue(null);

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'DISMISS' }),
      { status: 404, code: 'REPORT_NOT_FOUND' },
    );
  });

  it('báo cáo đã đóng (Admin khác xử lý trước) ⇒ 409 REPORT_ALREADY_CLOSED, không chạy hành động nào', async () => {
    const { service, prisma, adminService, notifications } = setup();
    prisma.$queryRaw.mockResolvedValue([
      { status: 'RESOLVED', snapshot: { name: 'Shop A', slug: 'a' } },
    ]);

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'SUSPEND_SHOP', note: NOTE }),
      { status: 409, code: 'REPORT_ALREADY_CLOSED' },
    );

    expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['SHOP', 'HIDE_REVIEW'],
    ['SHOP', 'TAKE_DOWN_PRODUCT'],
    ['SHOP', 'SUSPEND_REPORTED_USER'],
    ['SHOP', 'BLOCK_BUYER'],
  ] as const)(
    'hành động %2$s không thuộc loại %1$s ⇒ 409 REPORT_ACTION_NOT_ALLOWED, không chạy gì',
    async (_type, action) => {
      const { service, prisma, adminService } = setup();

      await expectAppException(
        service.resolve(ADMIN, REPORT, { action, note: NOTE }),
        { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
      );

      expect(adminService.changeShopStatusInTx).not.toHaveBeenCalled();
      expect(prisma.report.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([['CONVERSATION', 'BLOCK_BUYER']] as const)(
    'hành động %2$s hợp lệ với loại %1$s nhưng CHƯA có bộ xử lý (6.2) ⇒ 409, báo cáo vẫn mở',
    async (targetType, action) => {
      const { service, prisma } = setup();
      prisma.report.findUnique.mockResolvedValue({
        targetType,
        targetId: SHOP,
      });
      // BLOCK_BUYER chỉ hợp lệ khi người báo là SHOP (bên bị báo là người mua).
      prisma.$queryRaw.mockResolvedValue([
        {
          status: 'OPEN',
          snapshot: {
            shopName: 'Shop A',
            buyerName: 'Người mua',
            reporterRole: 'SHOP',
          },
        },
      ]);

      await expectAppException(
        service.resolve(ADMIN, REPORT, { action, note: NOTE }),
        { status: 409, code: 'REPORT_ACTION_NOT_ALLOWED' },
      );

      expect(prisma.report.updateMany).not.toHaveBeenCalled();
    },
  );

  it('số hàng đóng khác số hàng đã tìm thấy (đua ngoài khoá) ⇒ 409 và rollback, không ghi nhật ký', async () => {
    const { service, prisma, audit, notifications } = setup();
    prisma.report.updateMany.mockResolvedValue({ count: 1 });

    await expectAppException(
      service.resolve(ADMIN, REPORT, { action: 'DISMISS' }),
      { status: 409, code: 'REPORT_ALREADY_CLOSED' },
    );

    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lỗi nhật ký ⇒ rollback cả việc xử lý (không đóng báo cáo mà thiếu dấu vết) và không báo ai', async () => {
    const { service, audit, notifications } = setup();
    audit.record.mockRejectedValue(new Error('audit down'));

    await expect(
      service.resolve(ADMIN, REPORT, { action: 'DISMISS' }),
    ).rejects.toThrow('audit down');

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lỗi ghi của Prisma (mang nguyên giá trị đã ghi) bị che: lỗi ném ra không chứa ghi chú', async () => {
    const { service, prisma } = setup();
    prisma.report.updateMany.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        'Invalid invocation: data: { resolutionNote: "CANARY-GHI-CHU" }',
        { clientVersion: 'test' },
      ),
    );

    const error = await service
      .resolve(ADMIN, REPORT, { action: 'SUSPEND_SHOP', note: NOTE })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('CANARY');
    expect(String((error as Error).stack)).not.toContain('CANARY');
  });
});

describe('list và detail', () => {
  it('OPEN: cũ nhất trước, chỉ trạng thái OPEN, lọc loại khi có; phân trang đúng', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(0);
    prisma.report.findMany.mockResolvedValue([]);

    await service.list({
      status: 'OPEN',
      targetType: 'SHOP',
      page: 3,
      limit: 20,
    });

    expect(prisma.report.findMany).toHaveBeenCalledWith({
      where: { status: 'OPEN', targetType: 'SHOP' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 40,
      take: 20,
      select: expect.any(Object) as unknown,
    });
  });

  it('CLOSED: xử lý gần nhất trước, mọi hàng đã có thời điểm xử lý', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(0);
    prisma.report.findMany.mockResolvedValue([]);

    await service.list({ status: 'CLOSED', page: 1, limit: 20 });

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resolvedAt: { not: null } },
        orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('sameTargetOpenCount KHÔNG tính chính nó khi nó đang mở; báo cáo đã đóng thì tính đủ số báo cáo mở', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(2);
    prisma.report.findMany.mockResolvedValue([
      reportRow({ id: REPORT }),
      reportRow({
        id: SIBLING,
        targetId: BUYER,
        status: 'RESOLVED',
        resolvedById: ADMIN,
        resolutionAction: 'DISMISS',
        resolvedAt: CREATED,
      }),
    ]);
    prisma.report.groupBy.mockResolvedValue([
      { targetType: 'SHOP', targetId: SHOP, _count: { _all: 3 } },
      { targetType: 'SHOP', targetId: BUYER, _count: { _all: 1 } },
    ]);

    const result = await service.list({
      status: 'OPEN',
      page: 1,
      limit: 20,
    });

    expect(result.items.map((item) => item.sameTargetOpenCount)).toEqual([
      2, 1,
    ]);
  });

  it('số truy vấn không phụ thuộc số dòng: một lần tải người dùng và một lần đếm cho cả trang', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(30);
    prisma.report.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        reportRow({ id: `${i}`.padStart(8, '0') + REPORT.slice(8) }),
      ),
    );

    await service.list({ status: 'OPEN', page: 1, limit: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.report.groupBy).toHaveBeenCalledTimes(1);
  });

  it('dòng có ảnh chụp hỏng bị bỏ qua và ghi log (id), không làm hỏng cả hàng đợi', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(2);
    prisma.report.findMany.mockResolvedValue([
      reportRow({ id: REPORT, snapshot: { broken: true } }),
      reportRow({ id: SIBLING }),
    ]);

    const result = await service.list({ status: 'OPEN', page: 1, limit: 20 });

    expect(result.items.map((item) => item.id)).toEqual([SIBLING]);
    expect(String((logError.mock.calls[0] as unknown[])[0])).toContain(REPORT);
  });

  it('detail: id sai dạng và id không có ra cùng 404 REPORT_NOT_FOUND', async () => {
    const { service, prisma } = setup();
    prisma.report.findMany.mockResolvedValue([]);

    await expectAppException(service.detail('not-a-uuid'), {
      status: 404,
      code: 'REPORT_NOT_FOUND',
    });
    await expectAppException(service.detail(REPORT), {
      status: 404,
      code: 'REPORT_NOT_FOUND',
    });
  });
});
