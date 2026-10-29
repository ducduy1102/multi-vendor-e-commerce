import {
  ADMIN_ACCOUNT_STATUS_TRANSITIONS,
  ADMIN_USER_LIST_MAX_PAGE,
  ADMIN_USER_LIST_MAX_PAGE_SIZE,
  ADMIN_USER_REASON_MAX_LENGTH,
  ADMIN_USER_SEARCH_MAX_LENGTH,
  SERVER_ERROR_CODES,
  accountStatusSchema,
  accountStatusTargets,
  adminUserDetailSchema,
  adminUserHistoryEntrySchema,
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserReasonSchema,
  adminUserSchema,
  adminUserSuspendTargetSchema,
  canTransitionAccountStatus,
  reactivateUserSchema,
  suspendUserSchema,
  userRoleSchema,
  type AccountStatus,
} from '@ecommerce/types';
import { AccountStatus as PrismaAccountStatus, Role } from '@prisma/client';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Hợp đồng dùng chung của quản lý người dùng (packages/types/src/admin-user.ts, Week11.md 3.1). packages/types không có
// test runner riêng — test ở đây (cùng precedent admin-schemas.spec.ts). Ký tự đặc biệt dựng bằng String.fromCharCode để
// tệp nguồn không chứa ký tự điều khiển thật.
const NUL = String.fromCharCode(0);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

const ALL_STATUSES = accountStatusSchema.options;

describe('enum dùng chung khớp Prisma', () => {
  it('AccountStatus', () => {
    expect([...accountStatusSchema.options].sort()).toEqual(
      Object.values(PrismaAccountStatus).sort(),
    );
  });

  it('Role', () => {
    expect([...userRoleSchema.options].sort()).toEqual(
      Object.values(Role).sort(),
    );
  });
});

describe('bảng chuyển trạng thái tài khoản (D2)', () => {
  it('đúng năm cạnh Admin được phép, không hơn không kém', () => {
    expect(ADMIN_ACCOUNT_STATUS_TRANSITIONS).toEqual([
      { from: 'ACTIVE', to: 'SUSPENDED' },
      { from: 'ACTIVE', to: 'BANNED' },
      { from: 'SUSPENDED', to: 'BANNED' },
      { from: 'SUSPENDED', to: 'ACTIVE' },
      { from: 'BANNED', to: 'ACTIVE' },
    ]);
  });

  const allPairs = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to) => [from, to] as const),
  );

  it.each(allPairs)(
    'canTransitionAccountStatus(%s → %s) khớp bảng',
    (from, to) => {
      const expected = ADMIN_ACCOUNT_STATUS_TRANSITIONS.some(
        (edge) => edge.from === from && edge.to === to,
      );

      expect(canTransitionAccountStatus(from, to)).toBe(expected);
    },
  );

  it('không có cạnh tự trỏ về chính nó (khoá hai lần ⇒ 409, nên hai Admin bấm cùng lúc chỉ một bên thắng)', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionAccountStatus(status, status)).toBe(false);
    }
  });

  it('DEACTIVATED (người dùng tự xoá) không có cạnh vào hay ra: không thuộc Admin', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionAccountStatus('DEACTIVATED', status)).toBe(false);
      expect(canTransitionAccountStatus(status, 'DEACTIVATED')).toBe(false);
    }
  });

  it('không hạ mức BANNED → SUSPENDED (muốn nhẹ hơn thì mở lại rồi khoá lại)', () => {
    expect(canTransitionAccountStatus('BANNED', 'SUSPENDED')).toBe(false);
  });

  it('nâng mức SUSPENDED → BANNED được phép', () => {
    expect(canTransitionAccountStatus('SUSPENDED', 'BANNED')).toBe(true);
  });

  it.each([
    ['ACTIVE', ['SUSPENDED', 'BANNED']],
    ['SUSPENDED', ['BANNED', 'ACTIVE']],
    ['BANNED', ['ACTIVE']],
    ['DEACTIVATED', []],
  ] as const)('accountStatusTargets(%s)', (from, targets) => {
    expect(accountStatusTargets(from).sort()).toEqual([...targets].sort());
  });

  it('hai đích của endpoint khoá (SUSPENDED, BANNED) đúng bằng mọi đích KHÁC ACTIVE trong bảng; mở lại luôn về ACTIVE', () => {
    const nonActiveTargets = new Set(
      ADMIN_ACCOUNT_STATUS_TRANSITIONS.map((edge) => edge.to).filter(
        (to) => to !== 'ACTIVE',
      ),
    );

    expect(new Set(adminUserSuspendTargetSchema.options)).toEqual(
      nonActiveTargets,
    );
    // Mọi cạnh về ACTIVE xuất phát từ một trạng thái đang bị hạn chế (đúng điều kiện để mở lại).
    const reactivatable = ADMIN_ACCOUNT_STATUS_TRANSITIONS.filter(
      (edge) => edge.to === 'ACTIVE',
    ).map((edge) => edge.from);
    expect(reactivatable.sort()).toEqual(['BANNED', 'SUSPENDED']);
  });
});

describe('lý do (adminUserReasonSchema)', () => {
  it('cắt khoảng trắng hai đầu và chuẩn hoá CRLF/CR thành LF', () => {
    expect(adminUserReasonSchema.parse('  dòng 1\r\ndòng 2\rdòng 3  ')).toBe(
      'dòng 1\ndòng 2\ndòng 3',
    );
  });

  it('đúng giới hạn thì qua, hơn một ký tự thì báo key "quá dài"', () => {
    const exact = 'a'.repeat(ADMIN_USER_REASON_MAX_LENGTH);

    expect(adminUserReasonSchema.safeParse(exact).success).toBe(true);
    const tooLong = adminUserReasonSchema.safeParse(`${exact}a`);
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0].message).toBe(
        'admin.validationReasonTooLong',
      );
    }
  });

  it.each([
    ['chuỗi rỗng', ''],
    ['chỉ có khoảng trắng', ' \n\t '],
    ['không phải chuỗi (số)', 42],
    ['null', null],
    ['undefined', undefined],
  ])('từ chối lý do %s với key "bắt buộc nhập"', (_name, value) => {
    const result = adminUserReasonSchema.safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'admin.validationReasonRequired',
      );
    }
  });

  it.each([
    ['NUL', `lý do${NUL}`],
    ['bidi-override', `lý do${BIDI_OVERRIDE}`],
    ['dấu phân dòng Unicode', `lý do${LINE_SEPARATOR}khác`],
    ['tab', 'lý\tdo'],
  ])('từ chối lý do có %s với key "ký tự không hợp lệ"', (_name, value) => {
    const result = adminUserReasonSchema.safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'admin.validationReasonUnsafe',
      );
    }
  });

  it('lý do chứa <img onerror> được giữ NGUYÊN VĂN như chữ (React escape khi hiển thị)', () => {
    const reason = '<img src=x onerror=alert(1)>';

    expect(adminUserReasonSchema.parse(reason)).toBe(reason);
  });
});

describe('suspendUserSchema', () => {
  it.each(['SUSPENDED', 'BANNED'] as const)(
    'chấp nhận status %s kèm lý do',
    (status) => {
      expect(
        suspendUserSchema.parse({ status, reason: 'Vi phạm điều khoản' }),
      ).toEqual({
        status,
        reason: 'Vi phạm điều khoản',
      });
    },
  );

  it.each([
    ['ACTIVE (mở lại có endpoint riêng)', 'ACTIVE'],
    ['DEACTIVATED (người dùng tự xoá, không thuộc Admin)', 'DEACTIVATED'],
    ['giá trị lạ', 'DELETED'],
    ['chữ thường', 'suspended'],
    ['thiếu', undefined],
  ])('từ chối status %s', (_name, status) => {
    expect(
      suspendUserSchema.safeParse({ status, reason: 'Lý do' }).success,
    ).toBe(false);
  });

  it('thiếu lý do ⇒ lỗi gắn đúng đường dẫn `reason`', () => {
    const result = suspendUserSchema.safeParse({ status: 'SUSPENDED' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['reason']);
      expect(result.error.issues[0].message).toBe(
        'admin.validationReasonRequired',
      );
    }
  });

  it('khoá lạ (role, accountStatus, userId, statusChangedAt) bị loại: client không nhét được thứ gì ngoài status + reason', () => {
    const result = suspendUserSchema.parse({
      status: 'BANNED',
      reason: 'Lý do',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      userId: 'someone-else',
      statusChangedAt: '2000-01-01',
    });

    expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
  });
});

describe('reactivateUserSchema', () => {
  it('chỉ có lý do (đích luôn là ACTIVE), bắt buộc như khi khoá', () => {
    expect(
      reactivateUserSchema.parse({ reason: 'Khiếu nại được chấp nhận' }),
    ).toEqual({
      reason: 'Khiếu nại được chấp nhận',
    });
    expect(reactivateUserSchema.safeParse({}).success).toBe(false);
    expect(reactivateUserSchema.safeParse({ reason: '  ' }).success).toBe(
      false,
    );
  });

  it('không nhận `status` từ client: không có cách mở lại về trạng thái khác ACTIVE', () => {
    const result = reactivateUserSchema.parse({
      reason: 'Lý do',
      status: 'BANNED',
    });

    expect(result).toEqual({ reason: 'Lý do' });
  });
});

describe('adminUserListQuerySchema', () => {
  it('không có gì ⇒ trang 1, 20 dòng, không lọc (mọi trạng thái, mọi vai)', () => {
    expect(adminUserListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('query param là string: page/limit được ép kiểu số', () => {
    expect(
      adminUserListQuerySchema.parse({ page: '3', limit: '50' }),
    ).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it('page đúng trần thì qua, hơn một thì bị từ chối (trần chặn page=1e21 làm Postgres báo bigint out of range)', () => {
    expect(
      adminUserListQuerySchema.safeParse({
        page: String(ADMIN_USER_LIST_MAX_PAGE),
      }).success,
    ).toBe(true);
    for (const page of [
      String(ADMIN_USER_LIST_MAX_PAGE + 1),
      '1e21',
      '1e300',
    ]) {
      expect(adminUserListQuerySchema.safeParse({ page }).success).toBe(false);
    }
  });

  it.each([
    ['page = 0', { page: '0' }],
    ['page âm', { page: '-1' }],
    ['page thập phân', { page: '1.5' }],
    ['page không phải số', { page: 'abc' }],
    [
      `limit > ${ADMIN_USER_LIST_MAX_PAGE_SIZE}`,
      { limit: String(ADMIN_USER_LIST_MAX_PAGE_SIZE + 1) },
    ],
    ['limit = 0', { limit: '0' }],
  ])('từ chối %s', (_name, query) => {
    expect(adminUserListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('q được cắt khoảng trắng; rỗng hoặc toàn khoảng trắng ⇒ coi như không tìm (undefined)', () => {
    expect(adminUserListQuerySchema.parse({ q: '  an@example.com  ' }).q).toBe(
      'an@example.com',
    );
    expect(adminUserListQuerySchema.parse({ q: '' }).q).toBeUndefined();
    expect(adminUserListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('q giữ nguyên dấu và ký tự đặc biệt của LIKE (BE tự escape ở 3.2, schema không đoán)', () => {
    expect(adminUserListQuerySchema.parse({ q: 'Nguyễn 100%_a' }).q).toBe(
      'Nguyễn 100%_a',
    );
  });

  it(`q đúng ${ADMIN_USER_SEARCH_MAX_LENGTH} ký tự thì qua, hơn một ký tự thì báo key "quá dài"`, () => {
    const exact = 'a'.repeat(ADMIN_USER_SEARCH_MAX_LENGTH);

    expect(adminUserListQuerySchema.safeParse({ q: exact }).success).toBe(true);
    const tooLong = adminUserListQuerySchema.safeParse({ q: `${exact}a` });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0].message).toBe(
        'admin.validationSearchTooLong',
      );
    }
  });

  it.each([
    ['NUL (Postgres không nhận ⇒ sẽ thành 500 nếu lọt qua)', `a${NUL}b`],
    ['xuống dòng', 'a\nb'],
    ['bidi-override', `a${BIDI_OVERRIDE}`],
  ])('q chứa %s bị từ chối với key "ký tự không hợp lệ"', (_name, q) => {
    const result = adminUserListQuerySchema.safeParse({ q });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'admin.validationSearchUnsafe',
      );
    }
  });

  it('q lặp lại (?q=a&q=b ⇒ mảng) bị từ chối thay vì đoán', () => {
    expect(adminUserListQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(
      false,
    );
  });

  it.each(ALL_STATUSES)(
    'lọc theo status %s (kể cả DEACTIVATED để Admin tìm người tự xoá)',
    (status) => {
      expect(adminUserListQuerySchema.parse({ status }).status).toBe(status);
    },
  );

  it.each(['USER', 'ADMIN'])('lọc theo role %s', (role) => {
    expect(adminUserListQuerySchema.parse({ role }).role).toBe(role);
  });

  it.each([
    ['status lạ', { status: 'DELETED' }],
    ['role lạ', { role: 'SELLER' }],
  ])('từ chối %s', (_name, query) => {
    expect(adminUserListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('response: allowlist, không lộ trường nhạy cảm', () => {
  const user = {
    id: 'user-1',
    email: 'an@example.com',
    name: 'Nguyễn Văn An',
    role: 'USER',
    accountStatus: 'SUSPENDED',
    statusReason: 'Vi phạm điều khoản',
    statusChangedAt: '2026-10-27T10:00:00.000Z',
    isEmailVerified: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const SENSITIVE_FIELDS = [
    'passwordHash',
    'refreshTokenHash',
    'emailVerificationTokenHash',
    'emailVerificationExpiresAt',
    'emailVerificationSentAt',
    'emailVerifiedAt',
    'passwordResetTokenHash',
    'passwordResetExpiresAt',
    'passwordResetSentAt',
  ];

  it('hình dạng người dùng trong danh sách: đúng chín trường', () => {
    expect(Object.keys(adminUserSchema.shape).sort()).toEqual([
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
  });

  it.each([
    ['danh sách', adminUserSchema],
    ['chi tiết', adminUserDetailSchema],
  ])('schema %s không khai báo trường nhạy cảm nào', (_name, schema) => {
    for (const field of SENSITIVE_FIELDS) {
      expect(Object.keys(schema.shape)).not.toContain(field);
    }
  });

  it('response lỡ chứa hash/token ⇒ parse loại bỏ, không đi tiếp tới FE', () => {
    const leaked = {
      ...user,
      passwordHash: '$2b$10$secret',
      refreshTokenHash: 'abc',
      emailVerificationTokenHash: 'def',
      passwordResetTokenHash: 'ghi',
    };

    const parsed = adminUserSchema.parse(leaked);

    expect(JSON.stringify(parsed)).not.toMatch(/secret|abc|def|ghi|Hash/);
    expect(adminUserSchema.strict().safeParse(leaked).success).toBe(false);
  });

  it('người chưa từng bị đổi trạng thái: lý do và mốc là null', () => {
    const parsed = adminUserSchema.parse({
      ...user,
      accountStatus: 'ACTIVE',
      statusReason: null,
      statusChangedAt: null,
    });

    expect(parsed.statusReason).toBeNull();
    expect(parsed.statusChangedAt).toBeNull();
  });

  const detailBase = {
    ...user,
    locale: 'en',
    orderCount: 7,
    shops: [{ id: 's1', name: 'Shop A', slug: 'shop-a', status: 'SUSPENDED' }],
    history: [],
  };
  const historyEntry = {
    id: 'h1',
    action: 'SUSPEND_USER',
    actorId: 'admin-1',
    actorName: 'Quản trị viên',
    reason: 'Vi phạm điều khoản',
    meta: { from: 'ACTIVE', to: 'SUSPENDED', orderCount: 3, notified: true },
    createdAt: '2026-10-27T10:00:00.000Z',
  };

  it('danh sách có total/page/limit; chi tiết thêm ngôn ngữ, số đơn, shop sở hữu và lịch sử', () => {
    expect(
      adminUserListResponseSchema.parse({
        items: [user],
        total: 1,
        page: 1,
        limit: 20,
      }),
    ).toMatchObject({ total: 1, items: [{ id: 'user-1' }] });
    const detail = adminUserDetailSchema.parse({
      ...detailBase,
      history: [historyEntry],
    });
    expect(detail.shops[0].status).toBe('SUSPENDED');
    expect(detail.orderCount).toBe(7);
    expect(detail.history).toEqual([historyEntry]);
  });

  describe('lịch sử nhật ký trong chi tiết', () => {
    it('hình dạng một dòng: đúng bảy trường, KHÔNG có ip / userAgent của Admin', () => {
      expect(Object.keys(adminUserHistoryEntrySchema.shape).sort()).toEqual([
        'action',
        'actorId',
        'actorName',
        'createdAt',
        'id',
        'meta',
        'reason',
      ]);

      const parsed = adminUserHistoryEntrySchema.parse({
        ...historyEntry,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      });
      expect(JSON.stringify(parsed)).not.toMatch(/203\.0\.113|Mozilla/);
    });

    it('hành động lạ vẫn parse được (FE rơi về nhãn chung thay vì hỏng cả trang chi tiết)', () => {
      expect(
        adminUserHistoryEntrySchema.safeParse({
          ...historyEntry,
          action: 'SOME_FUTURE_ACTION',
        }).success,
      ).toBe(true);
    });

    it('Admin đã bị xoá (actorName null) và hành động không có lý do (reason null) đều hợp lệ', () => {
      expect(
        adminUserHistoryEntrySchema.safeParse({
          ...historyEntry,
          actorName: null,
          reason: null,
        }).success,
      ).toBe(true);
    });

    it.each([
      ['meta lồng nhau', { meta: { nested: { a: 1 } } }],
      ['meta chứa mảng', { meta: { ids: ['a', 'b'] } }],
      ['meta chứa null', { meta: { from: null } }],
      ['thiếu actorId', { actorId: undefined }],
    ])('từ chối %s', (_name, override) => {
      expect(
        adminUserHistoryEntrySchema.safeParse({ ...historyEntry, ...override })
          .success,
      ).toBe(false);
    });

    it('chi tiết thiếu `history` bị từ chối: BE luôn phải trả mảng (rỗng nếu chưa có gì)', () => {
      const { history: _history, ...withoutHistory } = detailBase;

      expect(adminUserDetailSchema.safeParse(withoutHistory).success).toBe(
        false,
      );
      expect(adminUserDetailSchema.safeParse(detailBase).success).toBe(true);
    });
  });

  it.each([
    ['trạng thái tài khoản lạ', { accountStatus: 'DELETED' }],
    ['vai lạ', { role: 'SELLER' }],
    ['thiếu isEmailVerified', { isEmailVerified: undefined }],
  ])('từ chối %s', (_name, override) => {
    expect(adminUserSchema.safeParse({ ...user, ...override }).success).toBe(
      false,
    );
  });
});

describe('mã lỗi mới', () => {
  it.each([
    'USER_NOT_FOUND',
    'USER_INVALID_TRANSITION',
    'CANNOT_MODIFY_ADMIN',
    'CANNOT_MODIFY_SELF',
    'SHOP_OWNER_NOT_ACTIVE',
  ])('%s nằm trong danh sách mã lỗi BE trả', (code) => {
    expect(SERVER_ERROR_CODES).toContain(code);
  });
});

describe('khớp với DB', () => {
  const apiRoot = join(__dirname, '..', '..', '..');
  const migrationSql = () => {
    const migrationsDir = join(apiRoot, 'prisma', 'migrations');
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_user_status_reason'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };

  it('ADMIN_USER_REASON_MAX_LENGTH bằng cận trên của CHECK status_reason (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const match =
      /char_length\("status_reason"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        migrationSql(),
      );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(ADMIN_USER_REASON_MAX_LENGTH);
  });

  it('cột `status_reason` là VARCHAR đúng cận đó, cả ở migration lẫn schema.prisma', () => {
    const column = /"status_reason"\s+VARCHAR\((\d+)\)/.exec(migrationSql());
    const prisma = readFileSync(
      join(apiRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model =
      /statusReason\s+String\?\s+@map\("status_reason"\)\s+@db\.VarChar\((\d+)\)/.exec(
        prisma,
      );

    expect(Number(column?.[1])).toBe(ADMIN_USER_REASON_MAX_LENGTH);
    expect(Number(model?.[1])).toBe(ADMIN_USER_REASON_MAX_LENGTH);
  });

  it('migration không backfill (không UPDATE/INSERT nào: người dùng cũ giữ hai cột NULL)', () => {
    expect(migrationSql()).not.toMatch(/\b(UPDATE|INSERT)\b/i);
  });
});

describe('kiểu dùng chung', () => {
  it('AccountStatus của packages/types dùng được làm khoá chỉ-đọc cho FE (không cần Prisma)', () => {
    const status: AccountStatus = 'BANNED';

    expect(canTransitionAccountStatus(status, 'ACTIVE')).toBe(true);
  });
});
