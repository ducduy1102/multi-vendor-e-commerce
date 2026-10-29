import {
  ADMIN_NOTE_CONTENT_MAX_LENGTH,
  ADMIN_NOTE_LIST_MAX_PAGE_SIZE,
  ADMIN_NOTE_TARGET_TYPES,
  LIST_MAX_PAGE,
  SERVER_ERROR_CODES,
  adminNoteContentSchema,
  adminNoteCreatedResponseSchema,
  adminNoteListQuerySchema,
  adminNoteListResponseSchema,
  adminNoteSchema,
  adminNoteTargetTypeSchema,
  createAdminNoteSchema,
} from '@ecommerce/types';
import { AdminNoteTargetType } from '@prisma/client';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Hợp đồng dùng chung của ghi chú nội bộ (packages/types/src/admin-note.ts, Week11.md 4.3). packages/types không có test
// runner riêng — test ở đây (cùng precedent admin-user-schemas.spec.ts). Ký tự đặc biệt dựng bằng String.fromCharCode để tệp
// nguồn không chứa ký tự điều khiển thật.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const ID = 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456';

describe('enum dùng chung khớp Prisma', () => {
  it('AdminNoteTargetType', () => {
    expect([...adminNoteTargetTypeSchema.options].sort()).toEqual(
      Object.values(AdminNoteTargetType).sort(),
    );
    expect([...ADMIN_NOTE_TARGET_TYPES].sort()).toEqual(
      Object.values(AdminNoteTargetType).sort(),
    );
  });
});

describe('nội dung ghi chú', () => {
  it('cắt khoảng trắng hai đầu và chuẩn hoá CRLF/CR về LF, giữ xuống dòng giữa các dòng', () => {
    expect(adminNoteContentSchema.parse('  dòng 1\r\ndòng 2\rdòng 3  ')).toBe(
      'dòng 1\ndòng 2\ndòng 3',
    );
  });

  it.each(['', '   ', '\n\n', '\r\n  \r\n'])(
    'rỗng hoặc chỉ khoảng trắng (%j) bị từ chối với key i18n "bắt buộc"',
    (value) => {
      const result = adminNoteContentSchema.safeParse(value);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'admin.validationNoteRequired',
      );
    },
  );

  it('thiếu hoặc sai kiểu cũng ra key "bắt buộc"', () => {
    for (const value of [undefined, null, 5, {}]) {
      const result = adminNoteContentSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'admin.validationNoteRequired',
      );
    }
  });

  it('đúng cận 1000 ký tự thì qua, 1001 thì bị từ chối với key "quá dài"', () => {
    expect(
      adminNoteContentSchema.safeParse(
        'a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH),
      ).success,
    ).toBe(true);

    const result = adminNoteContentSchema.safeParse(
      'a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH + 1),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('admin.validationNoteTooLong');
  });

  it('cận độ dài tính SAU khi cắt khoảng trắng', () => {
    expect(
      adminNoteContentSchema.safeParse(
        `   ${'a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH)}   `,
      ).success,
    ).toBe(true);
  });

  it.each([
    ['NUL', `abc${NUL}def`],
    ['tab', `abc${TAB}def`],
    ['bidi-override', `abc${BIDI_OVERRIDE}def`],
    ['dấu phân dòng Unicode', `abc${LINE_SEPARATOR}def`],
  ])('ký tự không an toàn (%s) bị từ chối với key "không an toàn"', (_n, v) => {
    const result = adminNoteContentSchema.safeParse(v);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('admin.validationNoteUnsafe');
  });

  it('không chặn <, > và dấu nháy: ghi chú hiển thị như chữ (React tự escape)', () => {
    const text = 'Chủ shop hỏi "size < 5kg" và <b>gửi lại</b>';

    expect(adminNoteContentSchema.parse(text)).toBe(text);
  });
});

describe('body tạo ghi chú', () => {
  const valid = { targetType: 'SHOP', targetId: ID, content: 'Ghi chú' };

  it('hợp lệ cho cả USER và SHOP', () => {
    for (const targetType of ADMIN_NOTE_TARGET_TYPES) {
      expect(
        createAdminNoteSchema.safeParse({ ...valid, targetType }).success,
      ).toBe(true);
    }
  });

  it('tác giả và thời điểm KHÔNG đặt được từ client: field lạ bị bỏ khi parse', () => {
    const parsed = createAdminNoteSchema.parse({
      ...valid,
      authorId: 'someone-else',
      createdAt: '2020-01-01T00:00:00.000Z',
      id: 'x',
    });

    expect(Object.keys(parsed).sort()).toEqual([
      'content',
      'targetId',
      'targetType',
    ]);
  });

  it.each([
    ['loại đối tượng lạ', { targetType: 'PRODUCT' }],
    ['thiếu loại đối tượng', { targetType: undefined }],
    ['id không phải UUID', { targetId: 'not-a-uuid' }],
    ['id có NUL', { targetId: `${ID}${NUL}` }],
    ['thiếu nội dung', { content: undefined }],
  ])('%s bị từ chối', (_name, override) => {
    expect(
      createAdminNoteSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});

describe('query danh sách ghi chú', () => {
  const base = { targetType: 'USER', targetId: ID };

  it('mặc định page=1, limit=20; chuỗi số từ URL được coerce', () => {
    expect(adminNoteListQuerySchema.parse(base)).toMatchObject({
      page: 1,
      limit: 20,
    });
    expect(
      adminNoteListQuerySchema.parse({ ...base, page: '3', limit: '50' }),
    ).toMatchObject({ page: 3, limit: 50 });
  });

  it('bắt buộc đủ targetType và targetId (không có API đọc ghi chú toàn sàn)', () => {
    expect(adminNoteListQuerySchema.safeParse({}).success).toBe(false);
    expect(
      adminNoteListQuerySchema.safeParse({ targetType: 'USER' }).success,
    ).toBe(false);
    expect(adminNoteListQuerySchema.safeParse({ targetId: ID }).success).toBe(
      false,
    );
  });

  it('limit tối đa 50 và page có trần LIST_MAX_PAGE', () => {
    expect(
      adminNoteListQuerySchema.safeParse({
        ...base,
        limit: String(ADMIN_NOTE_LIST_MAX_PAGE_SIZE),
      }).success,
    ).toBe(true);
    expect(
      adminNoteListQuerySchema.safeParse({
        ...base,
        limit: String(ADMIN_NOTE_LIST_MAX_PAGE_SIZE + 1),
      }).success,
    ).toBe(false);
    expect(
      adminNoteListQuerySchema.safeParse({
        ...base,
        page: String(LIST_MAX_PAGE),
      }).success,
    ).toBe(true);
    for (const page of [String(LIST_MAX_PAGE + 1), '1e21', '0', '-1', 'abc']) {
      expect([
        page,
        adminNoteListQuerySchema.safeParse({ ...base, page }).success,
      ]).toEqual([page, false]);
    }
  });
});

describe('response (allowlist)', () => {
  const note = {
    id: 'n1',
    targetType: 'SHOP',
    targetId: ID,
    content: 'Ghi chú',
    authorId: 'a1',
    authorName: 'Quản trị viên',
    createdAt: '2026-10-28T10:00:00.000Z',
  };

  it('một ghi chú hợp lệ; authorName có thể null (Admin không còn)', () => {
    expect(adminNoteSchema.safeParse(note).success).toBe(true);
    expect(
      adminNoteSchema.safeParse({ ...note, authorName: null }).success,
    ).toBe(true);
  });

  it('KHÔNG có email hay thông tin liên hệ: field lạ bị bỏ khi parse', () => {
    const parsed = adminNoteSchema.parse({
      ...note,
      authorEmail: 'admin@example.com',
      email: 'admin@example.com',
    });

    expect(JSON.stringify(parsed)).not.toContain('admin@example.com');
    expect(Object.keys(parsed).sort()).toEqual([
      'authorId',
      'authorName',
      'content',
      'createdAt',
      'id',
      'targetId',
      'targetType',
    ]);
  });

  it('danh sách và response tạo mới có hình dạng đúng', () => {
    expect(
      adminNoteListResponseSchema.safeParse({
        items: [note],
        total: 1,
        page: 1,
        limit: 20,
      }).success,
    ).toBe(true);
    expect(adminNoteCreatedResponseSchema.safeParse({ note }).success).toBe(
      true,
    );
    expect(adminNoteCreatedResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('mã lỗi', () => {
  it('ADMIN_NOTE_TARGET_NOT_FOUND nằm trong danh sách mã lỗi BE trả', () => {
    expect(SERVER_ERROR_CODES).toContain('ADMIN_NOTE_TARGET_NOT_FOUND');
  });
});

describe('khớp với DB', () => {
  const apiRoot = join(__dirname, '..', '..', '..');
  const migrationSql = () => {
    const migrationsDir = join(apiRoot, 'prisma', 'migrations');
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_admin_notes'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };

  it('ADMIN_NOTE_CONTENT_MAX_LENGTH bằng cận trên của CHECK content (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const match = /char_length\("content"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(ADMIN_NOTE_CONTENT_MAX_LENGTH);
  });

  it('enum Postgres của migration có đúng các loại đối tượng của hợp đồng', () => {
    const match = /CREATE TYPE "AdminNoteTargetType" AS ENUM \(([^)]*)\)/.exec(
      migrationSql(),
    );
    const values = (match?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/'/g, ''))
      .sort();

    expect(values).toEqual([...ADMIN_NOTE_TARGET_TYPES].sort());
  });

  it('migration có trigger chặn UPDATE/DELETE và TRUNCATE (bảng chỉ thêm ngay ở DB)', () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /CREATE TRIGGER "admin_notes_no_update_delete"\s+BEFORE UPDATE OR DELETE ON "admin_notes"/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER "admin_notes_no_truncate"\s+BEFORE TRUNCATE ON "admin_notes"/,
    );
  });

  it('bảng không có khoá ngoại tới users/shops (ghi chú sống lâu hơn đối tượng) và schema.prisma không có quan hệ ngược', () => {
    expect(migrationSql()).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    const prisma = readFileSync(
      join(apiRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model = /model AdminNote \{[\s\S]*?\n\}/.exec(prisma)?.[0] ?? '';
    expect(model).not.toBe('');
    expect(model).not.toMatch(/@relation/);
    // Không User/Shop nào khai `notes AdminNote[]` — không có đường include ghi chú vào response của route khác.
    expect(prisma).not.toMatch(/AdminNote\[\]/);
  });
});
