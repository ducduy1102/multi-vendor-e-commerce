import {
  ADMIN_APPEAL_LIST_FILTERS,
  APPEAL_DECISION_NOTE_MAX_LENGTH,
  APPEAL_LIST_MAX_PAGE_SIZE,
  APPEAL_MESSAGE_MAX_LENGTH,
  APPEAL_STATES,
  APPEAL_STATUSES,
  APPEAL_TARGET_TYPES,
  LIST_MAX_PAGE,
  SERVER_ERROR_CODES,
  adminAppealListQuerySchema,
  adminAppealSchema,
  appealDecisionNoteSchema,
  appealMessageSchema,
  appealStateSchema,
  appealStatusSchema,
  appealTargetTypeSchema,
  createAppealSchema,
  decideAppealSchema,
  deriveAppealState,
  isAppealEpisodeCurrent,
  ownerAppealSchema,
  shopAppealsResponseSchema,
} from '@ecommerce/types';
import { AppealStatus, AppealTargetType } from '@prisma/client';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Hợp đồng dùng chung của kháng nghị (packages/types/src/appeal.ts, Week11.md 4.6). packages/types không có test runner riêng —
// test ở đây (cùng precedent admin-note-schemas.spec.ts). Ký tự đặc biệt dựng bằng String.fromCharCode để tệp nguồn không chứa
// ký tự điều khiển thật.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('enum dùng chung khớp Prisma', () => {
  it('AppealTargetType', () => {
    expect([...appealTargetTypeSchema.options].sort()).toEqual(
      Object.values(AppealTargetType).sort(),
    );
    expect([...APPEAL_TARGET_TYPES].sort()).toEqual(
      Object.values(AppealTargetType).sort(),
    );
  });

  it('AppealStatus (trạng thái LƯU) — trạng thái hiển thị chỉ thêm CLOSED, vốn không bao giờ ghi vào DB', () => {
    expect([...appealStatusSchema.options].sort()).toEqual(
      Object.values(AppealStatus).sort(),
    );
    expect([...APPEAL_STATUSES].sort()).toEqual(
      Object.values(AppealStatus).sort(),
    );
    expect([...appealStateSchema.options].sort()).toEqual(
      [...Object.values(AppealStatus), 'CLOSED'].sort(),
    );
    expect([...APPEAL_STATES].sort()).toEqual(
      [...ADMIN_APPEAL_LIST_FILTERS].sort(),
    );
  });
});

describe('lời kháng nghị', () => {
  it('cắt khoảng trắng hai đầu và chuẩn hoá CRLF/CR về LF, giữ xuống dòng giữa các dòng', () => {
    expect(appealMessageSchema.parse('  dòng 1\r\ndòng 2\rdòng 3  ')).toBe(
      'dòng 1\ndòng 2\ndòng 3',
    );
  });

  it.each(['', '   ', '\n\n', '\r\n  \r\n'])(
    'rỗng hoặc chỉ khoảng trắng (%j) bị từ chối với key i18n "bắt buộc"',
    (value) => {
      const result = appealMessageSchema.safeParse(value);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'appeal.validationMessageRequired',
      );
    },
  );

  it('thiếu hoặc sai kiểu cũng ra key "bắt buộc"', () => {
    for (const value of [undefined, null, 5, {}]) {
      const result = appealMessageSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'appeal.validationMessageRequired',
      );
    }
  });

  it('đúng cận 1000 ký tự thì qua, 1001 thì bị từ chối với key "quá dài"', () => {
    expect(
      appealMessageSchema.safeParse('a'.repeat(APPEAL_MESSAGE_MAX_LENGTH))
        .success,
    ).toBe(true);

    const result = appealMessageSchema.safeParse(
      'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'appeal.validationMessageTooLong',
    );
  });

  it('cận độ dài tính SAU khi cắt khoảng trắng', () => {
    expect(
      appealMessageSchema.safeParse(
        `   ${'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH)}   `,
      ).success,
    ).toBe(true);
  });

  it.each([
    ['NUL', `abc${NUL}def`],
    ['tab', `abc${TAB}def`],
    ['bidi-override', `abc${BIDI_OVERRIDE}def`],
    ['dấu phân dòng Unicode', `abc${LINE_SEPARATOR}def`],
  ])('ký tự không an toàn (%s) bị từ chối với key "không an toàn"', (_n, v) => {
    const result = appealMessageSchema.safeParse(v);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'appeal.validationMessageUnsafe',
    );
  });

  it('không chặn <, > và dấu nháy: lời kháng nghị hiển thị như chữ (React tự escape)', () => {
    const text = 'Shop bán "áo < 5 triệu" và <b>đã gỡ</b> hàng bị báo cáo';

    expect(appealMessageSchema.parse(text)).toBe(text);
  });
});

describe('body gửi kháng nghị', () => {
  it('người gửi, shop, trạng thái và mốc bị xử lý KHÔNG đặt được từ client: field lạ bị bỏ khi parse', () => {
    const parsed = createAppealSchema.parse({
      message: 'Xin xem xét lại',
      appellantId: 'someone-else',
      targetId: 'another-shop',
      targetType: 'PRODUCT',
      status: 'ACCEPTED',
      moderationEventAt: '2020-01-01T00:00:00.000Z',
      decidedById: 'x',
    });

    expect(Object.keys(parsed)).toEqual(['message']);
  });

  it('thiếu lời kháng nghị bị từ chối', () => {
    expect(createAppealSchema.safeParse({}).success).toBe(false);
  });
});

describe('ghi chú quyết định', () => {
  it('cùng cách chuẩn hoá và cùng cận 500 ký tự', () => {
    expect(appealDecisionNoteSchema.parse('  lý do\r\nhai  ')).toBe(
      'lý do\nhai',
    );
    expect(
      appealDecisionNoteSchema.safeParse(
        'a'.repeat(APPEAL_DECISION_NOTE_MAX_LENGTH),
      ).success,
    ).toBe(true);
    const tooLong = appealDecisionNoteSchema.safeParse(
      'a'.repeat(APPEAL_DECISION_NOTE_MAX_LENGTH + 1),
    );
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0].message).toBe(
      'admin.validationAppealNoteTooLong',
    );
  });

  it('ký tự không an toàn bị từ chối với key riêng của khu Admin', () => {
    const result = appealDecisionNoteSchema.safeParse(`lý do${NUL}`);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'admin.validationAppealNoteUnsafe',
    );
  });
});

describe('body quyết định kháng nghị', () => {
  it('chấp nhận không cần ghi chú; ghi chú tuỳ chọn khi chấp nhận', () => {
    expect(decideAppealSchema.safeParse({ decision: 'ACCEPT' }).success).toBe(
      true,
    );
    expect(
      decideAppealSchema.parse({ decision: 'ACCEPT', note: '  Đã đủ giấy tờ ' })
        .note,
    ).toBe('Đã đủ giấy tờ');
  });

  it('từ chối BẮT BUỘC có ghi chú (chủ shop đọc được lý do này), lỗi gắn đúng field `note`', () => {
    const result = decideAppealSchema.safeParse({ decision: 'REJECT' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['note'],
      message: 'admin.validationAppealNoteRequired',
    });
    expect(
      decideAppealSchema.safeParse({ decision: 'REJECT', note: 'Chưa đủ' })
        .success,
    ).toBe(true);
  });

  it('ghi chú rỗng hoặc chỉ khoảng trắng = CHƯA NHẬP (ô nhập HTML bỏ trống gửi ""): chấp nhận vẫn qua với note undefined, từ chối vẫn thiếu ghi chú', () => {
    for (const note of ['', '   ', '\n \r\n']) {
      const accepted = decideAppealSchema.safeParse({
        decision: 'ACCEPT',
        note,
      });
      expect([note, accepted.success]).toEqual([note, true]);
      expect(accepted.data?.note).toBeUndefined();

      const rejected = decideAppealSchema.safeParse({
        decision: 'REJECT',
        note,
      });
      expect([note, rejected.success]).toEqual([note, false]);
      expect(rejected.error?.issues[0]).toMatchObject({
        path: ['note'],
        message: 'admin.validationAppealNoteRequired',
      });
    }
  });

  it('ghi chú có nội dung vẫn qua đủ luật: quá dài / ký tự không an toàn bị từ chối với key riêng', () => {
    const tooLong = decideAppealSchema.safeParse({
      decision: 'ACCEPT',
      note: 'a'.repeat(APPEAL_DECISION_NOTE_MAX_LENGTH + 1),
    });
    const unsafe = decideAppealSchema.safeParse({
      decision: 'ACCEPT',
      note: `lý do${NUL}`,
    });

    expect(tooLong.error?.issues[0].message).toBe(
      'admin.validationAppealNoteTooLong',
    );
    expect(unsafe.error?.issues[0].message).toBe(
      'admin.validationAppealNoteUnsafe',
    );
  });

  it.each([
    ['quyết định lạ', { decision: 'APPROVE' }],
    ['thiếu quyết định', { note: 'x' }],
    ['ghi chú quá 500 ký tự', { decision: 'REJECT', note: 'a'.repeat(501) }],
  ])('%s bị từ chối', (_name, body) => {
    expect(decideAppealSchema.safeParse(body).success).toBe(false);
  });

  it('người quyết định và thời điểm KHÔNG đặt được từ client: field lạ bị bỏ khi parse', () => {
    const parsed = decideAppealSchema.parse({
      decision: 'ACCEPT',
      decidedById: 'someone-else',
      decidedAt: '2020-01-01T00:00:00.000Z',
      status: 'REJECTED',
    });

    expect(Object.keys(parsed)).toEqual(['decision']);
  });
});

describe('query hàng đợi của Admin', () => {
  it('mặc định PENDING, page=1, limit=20; chuỗi số từ URL được coerce', () => {
    expect(adminAppealListQuerySchema.parse({})).toEqual({
      status: 'PENDING',
      page: 1,
      limit: 20,
    });
    expect(
      adminAppealListQuerySchema.parse({ page: '3', limit: '50' }),
    ).toMatchObject({ page: 3, limit: 50 });
  });

  it('nhận đủ bốn bộ lọc, kể cả CLOSED; trạng thái lạ bị từ chối', () => {
    for (const status of ADMIN_APPEAL_LIST_FILTERS) {
      expect(adminAppealListQuerySchema.safeParse({ status }).success).toBe(
        true,
      );
    }
    expect(
      adminAppealListQuerySchema.safeParse({ status: 'ALL' }).success,
    ).toBe(false);
  });

  it('limit tối đa 50 và page có trần LIST_MAX_PAGE', () => {
    expect(
      adminAppealListQuerySchema.safeParse({
        limit: String(APPEAL_LIST_MAX_PAGE_SIZE),
      }).success,
    ).toBe(true);
    expect(
      adminAppealListQuerySchema.safeParse({
        limit: String(APPEAL_LIST_MAX_PAGE_SIZE + 1),
      }).success,
    ).toBe(false);
    expect(
      adminAppealListQuerySchema.safeParse({ page: String(LIST_MAX_PAGE) })
        .success,
    ).toBe(true);
    for (const page of [String(LIST_MAX_PAGE + 1), '1e21', '0', '-1', 'abc']) {
      expect([
        page,
        adminAppealListQuerySchema.safeParse({ page }).success,
      ]).toEqual([page, false]);
    }
  });
});

describe('kháng nghị còn hiệu lực không (hàm thuần dùng chung BE/FE)', () => {
  const at = new Date('2026-10-28T10:00:00.000Z');

  it.each([
    ['cùng lần khoá, shop vẫn SUSPENDED', 'SUSPENDED', at, true],
    [
      'shop bị khoá lại một lần khác (mốc đổi)',
      'SUSPENDED',
      new Date('2026-10-29T10:00:00.000Z'),
      false,
    ],
    ['shop đã được mở khoá (APPROVED)', 'APPROVED', at, false],
    ['shop bị từ chối', 'REJECTED', at, false],
    ['shop chờ duyệt', 'PENDING', at, false],
  ])('%s', (_name, status, statusChangedAt, expected) => {
    expect(isAppealEpisodeCurrent({ status, statusChangedAt }, at)).toBe(
      expected,
    );
  });

  it('so theo THỜI ĐIỂM, không theo kiểu dữ liệu (Date lẫn chuỗi ISO)', () => {
    expect(
      isAppealEpisodeCurrent(
        { status: 'SUSPENDED', statusChangedAt: at.toISOString() },
        at,
      ),
    ).toBe(true);
    expect(
      isAppealEpisodeCurrent(
        { status: 'SUSPENDED', statusChangedAt: at },
        at.toISOString(),
      ),
    ).toBe(true);
  });

  it('chênh một mili-giây là một lần khoá KHÁC', () => {
    expect(
      isAppealEpisodeCurrent(
        {
          status: 'SUSPENDED',
          statusChangedAt: new Date(at.getTime() + 1),
        },
        at,
      ),
    ).toBe(false);
  });

  it('trạng thái hiển thị: chỉ PENDING mới có thể thành CLOSED; ACCEPTED/REJECTED là kết quả cuối, giữ nguyên dù lần khoá còn hay hết', () => {
    expect(deriveAppealState('PENDING', true)).toBe('PENDING');
    expect(deriveAppealState('PENDING', false)).toBe('CLOSED');
    for (const status of ['ACCEPTED', 'REJECTED'] as const) {
      expect(deriveAppealState(status, true)).toBe(status);
      expect(deriveAppealState(status, false)).toBe(status);
    }
  });
});

describe('response (allowlist)', () => {
  const owner = {
    id: 'a1',
    state: 'PENDING',
    message: 'Xin xem xét lại',
    decisionNote: null,
    createdAt: '2026-10-29T08:00:00.000Z',
    decidedAt: null,
    moderationEventAt: '2026-10-28T10:00:00.000Z',
  };
  const admin = {
    ...owner,
    decidedByName: null,
    shop: {
      id: 's1',
      name: 'Shop A',
      slug: 'shop-a',
      logoUrl: null,
      status: 'SUSPENDED',
      statusReason: 'Bán hàng giả',
    },
    owner: { name: 'Chủ shop', email: 'owner@example.com' },
  };

  it('chủ shop KHÔNG thấy Admin nào đã quyết định (id lẫn tên): field lạ bị bỏ khi parse', () => {
    const parsed = ownerAppealSchema.parse({
      ...owner,
      decidedById: 'admin-1',
      decidedByName: 'Quản trị viên',
      appellantId: 'u1',
      targetId: 's1',
    });

    expect(Object.keys(parsed).sort()).toEqual(
      [
        'createdAt',
        'decidedAt',
        'decisionNote',
        'id',
        'message',
        'moderationEventAt',
        'state',
      ].sort(),
    );
  });

  it('phản hồi của chủ shop có `canAppeal` do server tính', () => {
    expect(
      shopAppealsResponseSchema.safeParse({
        appeals: [owner],
        canAppeal: false,
      }).success,
    ).toBe(true);
    expect(shopAppealsResponseSchema.safeParse({ appeals: [] }).success).toBe(
      false,
    );
  });

  it('Admin thấy shop và chủ shop nhưng KHÔNG thấy SĐT, địa chỉ hay id người kháng nghị', () => {
    const parsed = adminAppealSchema.parse({
      ...admin,
      appellantId: 'u1',
      decidedById: 'admin-1',
      owner: { ...admin.owner, phone: '0901234567', address: 'Hà Nội' },
      shop: { ...admin.shop, ownerId: 'u1' },
    });

    expect(JSON.stringify(parsed)).not.toMatch(
      /0901234567|Hà Nội|appellantId|decidedById|ownerId/,
    );
    expect(Object.keys(parsed.owner).sort()).toEqual(['email', 'name']);
  });
});

describe('mã lỗi', () => {
  it.each([
    'APPEAL_NOT_ALLOWED',
    'APPEAL_ALREADY_SENT',
    'APPEAL_NOT_FOUND',
    'APPEAL_ALREADY_DECIDED',
    'APPEAL_TARGET_CHANGED',
  ])('%s nằm trong danh sách mã lỗi BE trả', (errorCode) => {
    expect(SERVER_ERROR_CODES).toContain(errorCode);
  });
});

describe('khớp với DB', () => {
  const apiRoot = join(__dirname, '..', '..', '..');
  const migrationSql = () => {
    const migrationsDir = join(apiRoot, 'prisma', 'migrations');
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_appeals_table'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };
  const enumValues = (sql: string, name: string) => {
    const match = new RegExp(
      `CREATE TYPE "${name}" AS ENUM \\(([^)]*)\\)`,
    ).exec(sql);
    return (match?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/'/g, ''))
      .sort();
  };

  it('APPEAL_MESSAGE_MAX_LENGTH bằng cận trên của CHECK message (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const match = /char_length\("message"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(APPEAL_MESSAGE_MAX_LENGTH);
  });

  it('APPEAL_DECISION_NOTE_MAX_LENGTH bằng cận trên của CHECK decision_note', () => {
    const match =
      /char_length\("decision_note"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        migrationSql(),
      );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(APPEAL_DECISION_NOTE_MAX_LENGTH);
  });

  it('enum Postgres của migration có đúng các giá trị của hợp đồng', () => {
    const sql = migrationSql();

    expect(enumValues(sql, 'AppealTargetType')).toEqual(
      [...APPEAL_TARGET_TYPES].sort(),
    );
    expect(enumValues(sql, 'AppealStatus')).toEqual(
      [...APPEAL_STATUSES].sort(),
    );
  });

  it('migration có các CHECK giữ bất biến trạng thái ↔ cột quyết định và "từ chối phải có ghi chú"', () => {
    const sql = migrationSql();

    expect(sql).toContain('"appeals_status_matches_decision"');
    expect(sql).toContain('"appeals_rejection_has_note"');
  });

  it('migration có UNIQUE (target_type, target_id, moderation_event_at): trọng tài "mỗi lần bị khoá chỉ một kháng nghị"', () => {
    expect(migrationSql()).toMatch(
      /CREATE UNIQUE INDEX "appeals_target_type_target_id_moderation_event_at_key" ON "appeals"\("target_type", "target_id", "moderation_event_at"\)/,
    );
  });

  it('bảng không có khoá ngoại tới users/shops và schema.prisma không có quan hệ ngược (không đường `include` nào kéo lời kháng nghị vào route khác)', () => {
    expect(migrationSql()).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    const prisma = readFileSync(
      join(apiRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model = /model Appeal \{[\s\S]*?\n\}/.exec(prisma)?.[0] ?? '';
    expect(model).not.toBe('');
    expect(model).not.toMatch(/@relation/);
    expect(prisma).not.toMatch(/Appeal\[\]/);
  });
});
