import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeNotificationService,
  type FakeNotificationService,
} from '../../shared/testing/fake-notification-service';
import type { CreateReportDto } from './dto/create-report.dto';
import { REPORT_DAILY_LIMIT, REPORT_LIMIT_WINDOW_MS } from './report-config';
import type {
  ReportTargetDirectory,
  ResolvedReportTarget,
} from './report-target-directory';
import { ReportService, toReceipt } from './report.service';

// Logic không cần DB của ReportService (Week11.md 5.3): thứ tự các kiểm tra, trần đếm bằng DB, trọng tài khi hai lần gửi đụng nhau,
// thông báo chỉ phát SAU commit và chỉ mang id + loại, và ghi chú của người báo (văn bản riêng tư) không vào log hay lỗi. Khoá tư
// vấn, chỉ mục duy nhất từng phần và CHECK thật trên Postgres do report.controller.int-spec.ts kiểm.
const REPORTER = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-31T10:00:00.000Z');

const DTO: CreateReportDto = {
  targetType: 'SHOP',
  targetId: TARGET,
  reasonCode: 'SCAM',
  note: 'Lừa đảo, nhận tiền không giao hàng',
};

const SHOP_SNAPSHOT = { name: 'Shop A', slug: 'shop-a' };

function resolved(
  overrides: Partial<ResolvedReportTarget> = {},
): ResolvedReportTarget {
  return { ownedByReporter: false, snapshot: SHOP_SNAPSHOT, ...overrides };
}

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    targetType: 'SHOP' as const,
    status: 'OPEN' as const,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const calls: string[] = [];
  const prisma = {
    report: { findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
    $executeRaw: jest.fn(),
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
  prisma.report.findFirst.mockImplementation(() => {
    calls.push('findOpen');
    return Promise.resolve(null);
  });
  prisma.report.count.mockImplementation(() => {
    calls.push('count');
    return Promise.resolve(0);
  });
  prisma.report.create.mockImplementation(() => {
    calls.push('create');
    return Promise.resolve(receiptRow());
  });
  // `resolve` giữ riêng ở một biến để assert/đổi hành vi mà không vướng quy tắc unbound-method.
  const resolve = jest.fn().mockResolvedValue(resolved());
  const directory: ReportTargetDirectory = { resolve };
  const notifications: FakeNotificationService =
    createFakeNotificationService();
  const service = new ReportService(
    prisma as unknown as PrismaService,
    directory,
    notifications,
  );
  return { service, prisma, resolve, notifications, calls };
}

let log: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('toReceipt', () => {
  it('trả đúng bốn trường của biên nhận, thời gian dạng ISO', () => {
    expect(toReceipt(receiptRow())).toEqual({
      id: REPORT_ID,
      targetType: 'SHOP',
      status: 'OPEN',
      createdAt: '2026-10-31T10:00:00.000Z',
    });
  });

  it('hàng DB lỡ có thêm trường lạ (người báo, ghi chú, ảnh chụp, lý do) vẫn KHÔNG lọt vào biên nhận', () => {
    const leaky = receiptRow({
      reporterId: REPORTER,
      note: 'ghi chú riêng tư',
      snapshot: SHOP_SNAPSHOT,
      reasonCode: 'SCAM',
      resolvedById: 'admin-1',
    });

    const receipt = toReceipt(leaky);

    expect(Object.keys(receipt).sort()).toEqual([
      'createdAt',
      'id',
      'status',
      'targetType',
    ]);
    expect(JSON.stringify(receipt)).not.toMatch(
      /ghi chú riêng tư|Shop A|SCAM|admin-1/,
    );
  });
});

describe('ReportService.create — luồng thành công', () => {
  it('ghi báo cáo của đúng người báo với ảnh chụp đã kiểm, rồi trả biên nhận', async () => {
    const { service, prisma } = setup();

    const result = await service.create(REPORTER, DTO);

    expect(result).toEqual({
      report: {
        id: REPORT_ID,
        targetType: 'SHOP',
        status: 'OPEN',
        createdAt: '2026-10-31T10:00:00.000Z',
      },
    });
    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId: REPORTER,
        targetType: 'SHOP',
        targetId: TARGET,
        reasonCode: 'SCAM',
        note: 'Lừa đảo, nhận tiền không giao hàng',
        snapshot: SHOP_SNAPSHOT,
      },
      select: { id: true, targetType: true, status: true, createdAt: true },
    });
  });

  it('ghi chú không có thì lưu NULL (không phải chuỗi rỗng hay undefined)', async () => {
    const { service, prisma } = setup();

    await service.create(REPORTER, { ...DTO, note: undefined });

    const data = (
      prisma.report.create.mock.calls[0] as [{ data: { note: unknown } }]
    )[0].data;
    expect(data.note).toBeNull();
  });

  it('tra đối tượng THEO GÓC NHÌN của người báo', async () => {
    const { service, resolve } = setup();

    await service.create(REPORTER, DTO);

    expect(resolve).toHaveBeenCalledWith(REPORTER, 'SHOP', TARGET);
  });

  it('thứ tự trong giao dịch: khoá theo người báo → kiểm báo cáo đang mở → đếm trần → ghi', async () => {
    const { service, calls } = setup();

    await service.create(REPORTER, DTO);

    expect(calls).toEqual(['tx:begin', 'lock', 'findOpen', 'count', 'create']);
  });

  it('khoá tư vấn theo NGƯỜI BÁO (không theo đối tượng): hai báo cáo về hai đối tượng khác nhau của cùng một người xếp hàng nhau', async () => {
    const { service, prisma } = setup();

    await service.create(REPORTER, DTO);
    await service.create(REPORTER, { ...DTO, targetId: REPORT_ID });

    const keys = prisma.$executeRaw.mock.calls.map((call: unknown[]) =>
      String(call[1]),
    );
    expect(keys).toEqual([`report:${REPORTER}`, `report:${REPORTER}`]);
  });

  it('đếm trần trong cửa sổ trượt 24 giờ tính từ lúc gọi, trên MỌI báo cáo của người đó (cả đã đóng)', async () => {
    const { service, prisma } = setup();

    await service.create(REPORTER, DTO);

    expect(prisma.report.count).toHaveBeenCalledWith({
      where: {
        reporterId: REPORTER,
        createdAt: { gt: new Date(NOW.getTime() - REPORT_LIMIT_WINDOW_MS) },
      },
    });
    expect(REPORT_LIMIT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('kiểm báo cáo đang mở đúng bộ ba (người báo, loại, đối tượng) và chỉ trạng thái OPEN', async () => {
    const { service, prisma } = setup();

    await service.create(REPORTER, DTO);

    expect(prisma.report.findFirst).toHaveBeenCalledWith({
      where: {
        reporterId: REPORTER,
        targetType: 'SHOP',
        targetId: TARGET,
        status: 'OPEN',
      },
      select: { id: true },
    });
  });
});

describe('ReportService.create — từ chối', () => {
  it('đối tượng không "thấy" được ⇒ 404 REPORT_TARGET_NOT_FOUND và không chạm DB ghi', async () => {
    const { service, resolve, prisma, notifications } = setup();
    resolve.mockResolvedValue(null);

    await expectAppException(service.create(REPORTER, DTO), {
      status: 404,
      code: 'REPORT_TARGET_NOT_FOUND',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('nội dung của chính mình ⇒ 409 REPORT_OWN_CONTENT và không ghi', async () => {
    const { service, resolve, prisma } = setup();
    resolve.mockResolvedValue(resolved({ ownedByReporter: true }));

    await expectAppException(service.create(REPORTER, DTO), {
      status: 409,
      code: 'REPORT_OWN_CONTENT',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đã có báo cáo ĐANG MỞ ⇒ 409 REPORT_ALREADY_OPEN, không đếm trần và không ghi', async () => {
    const { service, prisma, notifications } = setup();
    prisma.report.findFirst.mockResolvedValue({ id: 'old' });

    await expectAppException(service.create(REPORTER, DTO), {
      status: 409,
      code: 'REPORT_ALREADY_OPEN',
    });

    expect(prisma.report.count).not.toHaveBeenCalled();
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('người đang ở sát trần mà báo trùng thấy "đã có báo cáo" (câu trả lời đúng), không phải "quá trần"', async () => {
    const { service, prisma } = setup();
    prisma.report.findFirst.mockResolvedValue({ id: 'old' });
    prisma.report.count.mockResolvedValue(REPORT_DAILY_LIMIT);

    await expectAppException(service.create(REPORTER, DTO), {
      status: 409,
      code: 'REPORT_ALREADY_OPEN',
    });
  });

  it('đủ trần ⇒ 429 REPORT_LIMIT_REACHED và không ghi', async () => {
    const { service, prisma, notifications } = setup();
    prisma.report.count.mockResolvedValue(REPORT_DAILY_LIMIT);

    await expectAppException(service.create(REPORTER, DTO), {
      status: 429,
      code: 'REPORT_LIMIT_REACHED',
    });

    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('còn dưới trần đúng một báo cáo thì vẫn ghi được; trần là 10', async () => {
    const { service, prisma } = setup();
    prisma.report.count.mockResolvedValue(REPORT_DAILY_LIMIT - 1);

    await expect(service.create(REPORTER, DTO)).resolves.toBeDefined();
    expect(REPORT_DAILY_LIMIT).toBe(10);
  });

  it('ảnh chụp do cổng trả sai hình dạng (lỗi lập trình) ⇒ lỗi chung, không ghi, thông điệp KHÔNG chứa giá trị', async () => {
    const { service, resolve, prisma } = setup();
    resolve.mockResolvedValue(
      resolved({
        snapshot: {
          name: 'Shop A',
          slug: 'shop-a',
          buyerEmail: 'CANARY@private.test',
        } as never,
      }),
    );

    const error = await service.create(REPORTER, DTO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppException);
    expect(String((error as Error).message)).not.toContain('CANARY');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ReportService.create — trọng tài khi hai lần gửi đụng nhau', () => {
  const uniqueViolation = (modelName: string) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName },
    });

  it('P2002 của chính bảng Report (chỉ mục duy nhất từng phần) ⇒ 409 REPORT_ALREADY_OPEN', async () => {
    const { service, prisma, notifications } = setup();
    prisma.report.create.mockRejectedValue(uniqueViolation('Report'));

    await expectAppException(service.create(REPORTER, DTO), {
      status: 409,
      code: 'REPORT_ALREADY_OPEN',
    });

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('P2002 của bảng KHÁC không bị nhầm thành "đã có báo cáo": lỗi gốc được ném lại', async () => {
    const { service, prisma } = setup();
    const other = uniqueViolation('User');
    prisma.report.create.mockRejectedValue(other);

    await expect(service.create(REPORTER, DTO)).rejects.toBe(other);
  });
});

describe('ReportService.create — thông báo và log', () => {
  it('báo mọi Admin SAU khi báo cáo đã được ghi, chỉ với id báo cáo và loại đối tượng', async () => {
    const { service, prisma, notifications } = setup();

    await service.create(REPORTER, DTO);

    expect(notifications.events).toEqual([
      { kind: 'REPORT_SUBMITTED', reportId: REPORT_ID, targetType: 'SHOP' },
    ]);
    expect(prisma.report.create.mock.invocationCallOrder[0]).toBeLessThan(
      notifications.notify.mock.invocationCallOrder[0],
    );
  });

  it('sự kiện thông báo không mang người báo, ghi chú, lý do hay tên đối tượng', async () => {
    const { service, notifications } = setup();

    await service.create(REPORTER, DTO);

    const text = JSON.stringify(notifications.events);
    expect(text).not.toContain(REPORTER);
    expect(text).not.toContain('Lừa đảo');
    expect(text).not.toContain('SCAM');
    expect(text).not.toContain('Shop A');
  });

  it('log chỉ có id báo cáo và loại đối tượng — không có ghi chú, người báo hay id đối tượng', async () => {
    const { service } = setup();

    await service.create(REPORTER, DTO);

    const lines = log.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(REPORT_ID);
    for (const line of lines) {
      expect(line).not.toContain('Lừa đảo');
      expect(line).not.toContain(REPORTER);
      expect(line).not.toContain(TARGET);
    }
  });

  it('lỗi ghi của Prisma (mang nguyên giá trị đã ghi) bị che: lỗi ném ra không chứa ghi chú của người báo', async () => {
    const { service, prisma } = setup();
    prisma.report.create.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        'Invalid invocation: data: { note: "CANARY-GHI-CHU-RIENG-TU" }',
        { clientVersion: 'test' },
      ),
    );

    const error = await service.create(REPORTER, DTO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('CANARY');
    expect(String((error as Error).stack)).not.toContain('CANARY');
  });
});
