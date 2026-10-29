import { Prisma } from '@prisma/client';
import { AdminUserService, toAdminUser } from './admin-user.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

// Logic không cần DB của AdminUserService (Week11.md 3.2): ánh xạ response không lộ gì ngoài allowlist, cách ghép các
// truy vấn của trang danh sách (offset, bỏ qua truy vấn thừa, giữ thứ tự). Tìm kiếm / lọc / đếm thật trên Postgres do
// admin-user.controller.int-spec.ts kiểm.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'an@example.com',
    name: 'Nguyễn Văn An',
    role: 'USER' as const,
    accountStatus: 'SUSPENDED' as const,
    statusReason: 'Vi phạm điều khoản',
    statusChangedAt: new Date('2026-10-27T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toAdminUser', () => {
  it('trả đúng chín trường của allowlist, mốc thời gian dạng ISO', () => {
    const result = toAdminUser(row());

    expect(result).toEqual({
      id: USER_ID,
      email: 'an@example.com',
      name: 'Nguyễn Văn An',
      role: 'USER',
      accountStatus: 'SUSPENDED',
      statusReason: 'Vi phạm điều khoản',
      statusChangedAt: '2026-10-27T10:00:00.000Z',
      isEmailVerified: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('chưa xác thực email ⇒ isEmailVerified false; chưa từng bị đổi ⇒ lý do và mốc null', () => {
    const result = toAdminUser(
      row({ emailVerifiedAt: null, statusReason: null, statusChangedAt: null }),
    );

    expect(result.isEmailVerified).toBe(false);
    expect(result.statusReason).toBeNull();
    expect(result.statusChangedAt).toBeNull();
  });

  it('hàng DB lỡ có thêm trường nhạy cảm vẫn KHÔNG lọt vào response (dựng thủ công, không spread)', () => {
    const leaky = row({
      passwordHash: '$2b$10$secret-hash',
      refreshTokenHash: 'refresh-secret',
      emailVerificationTokenHash: 'verify-secret',
      passwordResetTokenHash: 'reset-secret',
      emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    const result = toAdminUser(leaky);
    const json = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual([
      'accountStatus',
      'createdAt',
      'email',
      'id',
      'isEmailVerified',
      'name',
      'role',
      'statusChangedAt',
      'statusReason',
    ]);
    expect(json).not.toMatch(/secret|Hash|emailVerifiedAt/);
  });
});

// Các lần gọi `$queryRaw` của mock, có kiểu: mỗi lần gọi truyền đúng một `Prisma.Sql`.
const rawCalls = (mock: jest.Mock) => mock.mock.calls as [Prisma.Sql][];

describe('AdminUserService.listUsers', () => {
  function build(options: {
    pageIds: string[];
    total: number | bigint;
    users: ReturnType<typeof row>[];
  }) {
    const queryRaw = jest.fn();
    queryRaw
      .mockResolvedValueOnce(options.pageIds.map((id) => ({ id })))
      .mockResolvedValueOnce([{ total: options.total }]);
    const findMany = jest.fn().mockResolvedValue(options.users);
    const prisma = {
      $queryRaw: queryRaw,
      user: { findMany },
    } as unknown as PrismaService;
    return { service: new AdminUserService(prisma), queryRaw, findMany };
  }

  const defaults = { page: 1, limit: 20 };

  it('offset = (page - 1) * limit và limit được truyền làm tham số của câu lấy trang', async () => {
    const { service, queryRaw } = build({ pageIds: [], total: 0, users: [] });

    await service.listUsers({ ...defaults, page: 3, limit: 25 });

    const [pageQuery] = rawCalls(queryRaw)[0];
    expect(pageQuery.values).toEqual([25, 50]);
    expect(pageQuery.text).toMatch(
      /ORDER BY created_at DESC, id DESC LIMIT \$1 OFFSET \$2/,
    );
  });

  it('câu đếm và câu lấy trang dùng CÙNG bộ lọc (không thể lệch total)', async () => {
    const { service, queryRaw } = build({ pageIds: [], total: 0, users: [] });

    await service.listUsers({ ...defaults, q: 'an', role: 'USER' });

    const [[pageQuery], [countQuery]] = rawCalls(queryRaw);
    const filterOf = (sql: Prisma.Sql) =>
      /WHERE .*?(?= ORDER BY|$)/.exec(sql.text)?.[0];
    expect(filterOf(pageQuery)).toBeDefined();
    expect(filterOf(pageQuery)).toBe(filterOf(countQuery));
    expect(countQuery.values).toEqual(['%an%', '%an%', 'USER']);
  });

  it('trang rỗng ⇒ không chạy truy vấn đọc cột, total vẫn đúng (bigint của count được đổi sang số)', async () => {
    const { service, findMany } = build({ pageIds: [], total: 7n, users: [] });

    const result = await service.listUsers({ ...defaults, page: 9 });

    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 7, page: 9, limit: 20 });
  });

  it('giữ ĐÚNG thứ tự id của truy vấn lấy trang dù findMany trả về lộn xộn', async () => {
    const { service } = build({
      pageIds: [OTHER_ID, USER_ID],
      total: 2,
      users: [row({ id: USER_ID }), row({ id: OTHER_ID })],
    });

    const result = await service.listUsers(defaults);

    expect(result.items.map((item) => item.id)).toEqual([OTHER_ID, USER_ID]);
  });

  it('người dùng bị xoá giữa hai truy vấn thì bị bỏ qua, không làm hỏng cả trang', async () => {
    const { service } = build({
      pageIds: [OTHER_ID, USER_ID],
      total: 2,
      users: [row({ id: USER_ID })],
    });

    const result = await service.listUsers(defaults);

    expect(result.items.map((item) => item.id)).toEqual([USER_ID]);
  });

  it('chỉ đọc đúng các id của trang hiện tại, bằng select hẹp không có cột bí mật', async () => {
    const { service, findMany } = build({
      pageIds: [USER_ID],
      total: 1,
      users: [row()],
    });

    await service.listUsers(defaults);

    const [args] = (
      findMany.mock.calls as [
        { where: unknown; select: Record<string, unknown> },
      ][]
    )[0];
    expect(args.where).toEqual({ id: { in: [USER_ID] } });
    expect(Object.keys(args.select).sort()).toEqual([
      'accountStatus',
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
      'name',
      'role',
      'statusChangedAt',
      'statusReason',
    ]);
  });
});

describe('AdminUserService.getUser', () => {
  it.each([
    ['chuỗi tuỳ ý', 'abc'],
    ['rỗng', ''],
    [
      'có ký tự NUL (Postgres sẽ từ chối)',
      `${USER_ID}${String.fromCharCode(0)}`,
    ],
    ['UUID thiếu một ký tự', USER_ID.slice(0, -1)],
    ['SQL injection', "1' OR '1'='1"],
  ])('id %s ⇒ 404 USER_NOT_FOUND và KHÔNG chạm DB', async (_name, id) => {
    const findUnique = jest.fn();
    const findMany = jest.fn();
    const service = new AdminUserService({
      user: { findUnique, findMany },
      adminAuditLog: { findMany },
    } as unknown as PrismaService);

    await expect(service.getUser(id)).rejects.toMatchObject({
      status: 404,
      code: 'USER_NOT_FOUND',
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('meta hỏng trong nhật ký (ghi tay vào DB) ra {} thay vì đi tiếp tới response', async () => {
    const service = new AdminUserService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...row(),
          locale: 'vi',
          _count: { orders: 0 },
          shops: [],
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: OTHER_ID, name: 'Admin' }]),
      },
      adminAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'h1',
            action: 'SUSPEND_USER',
            actorId: OTHER_ID,
            reason: 'lý do',
            meta: { nested: { secret: 'x' } },
            createdAt: new Date('2026-10-27T10:00:00.000Z'),
          },
          {
            id: 'h2',
            action: 'REACTIVATE_USER',
            actorId: OTHER_ID,
            reason: null,
            meta: { from: 'SUSPENDED', to: 'ACTIVE' },
            createdAt: new Date('2026-10-26T10:00:00.000Z'),
          },
        ]),
      },
    } as unknown as PrismaService);

    const detail = await service.getUser(USER_ID);

    expect(detail.history[0].meta).toEqual({});
    expect(detail.history[1].meta).toEqual({ from: 'SUSPENDED', to: 'ACTIVE' });
    expect(JSON.stringify(detail)).not.toContain('secret');
  });
});
