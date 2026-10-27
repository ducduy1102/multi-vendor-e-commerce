import {
  ADMIN_AUDIT_ACTION_TARGETS,
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_IP_MAX_LENGTH,
  ADMIN_AUDIT_META_MAX_BYTES,
  ADMIN_AUDIT_META_MAX_KEYS,
  ADMIN_AUDIT_REASON_MAX_LENGTH,
  ADMIN_AUDIT_TARGET_TYPES,
  ADMIN_AUDIT_USER_AGENT_MAX_LENGTH,
  adminAuditEntrySchema,
  adminAuditIpSchema,
  adminAuditMetaSchema,
  adminAuditReasonSchema,
  adminAuditUserAgentSchema,
  type AdminAuditAction,
  type AdminAuditEntryInput,
} from '@ecommerce/types';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Schema dùng chung của nhật ký quản trị (packages/types/src/admin-audit.ts, Week11.md 2.3). Là hợp đồng giữa mọi nơi
// ghi nhật ký nên test ở đây khoá hình dạng: hành động nào tác động lên đối tượng nào, khoá lạ bị loại, `meta` không
// nhét được chữ tự do, và các con số khớp với CHECK của DB. Ký tự đặc biệt dựng bằng String.fromCharCode để tệp nguồn
// không chứa ký tự điều khiển thật.
const ACTOR_ID = randomUUID();
const TARGET_ID = randomUUID();

const entry = (
  overrides: Partial<AdminAuditEntryInput> = {},
  action: AdminAuditAction = 'SUSPEND_USER',
): AdminAuditEntryInput => ({
  actorId: ACTOR_ID,
  action,
  targetType: ADMIN_AUDIT_ACTION_TARGETS[action],
  targetId: TARGET_ID,
  ...overrides,
});

const NUL = String.fromCharCode(0);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('danh sách hành động và loại đối tượng', () => {
  it('có mười hành động, không trùng, và mỗi hành động trỏ tới một loại đối tượng đã khai báo', () => {
    expect(ADMIN_AUDIT_ACTIONS).toHaveLength(10);
    expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(ADMIN_AUDIT_TARGET_TYPES).toContain(
        ADMIN_AUDIT_ACTION_TARGETS[action],
      );
    }
  });

  it('không có loại đối tượng "mồ côi": loại nào cũng có ít nhất một hành động', () => {
    const used = new Set(Object.values(ADMIN_AUDIT_ACTION_TARGETS));
    for (const type of ADMIN_AUDIT_TARGET_TYPES) {
      expect(used.has(type)).toBe(true);
    }
  });
});

describe('adminAuditEntrySchema', () => {
  describe('chấp nhận', () => {
    it.each(ADMIN_AUDIT_ACTIONS.map((action) => [action]))(
      'hành động %s với đúng loại đối tượng của nó',
      (action) => {
        const result = adminAuditEntrySchema.safeParse(entry({}, action));

        expect(result.success).toBe(true);
      },
    );

    it('không có lý do và meta ⇒ cả hai để trống (service sẽ ghi NULL và {})', () => {
      const result = adminAuditEntrySchema.parse(entry());

      expect(result.reason).toBeUndefined();
      expect(result.meta).toBeUndefined();
    });

    it('lý do null được coi như không có lý do', () => {
      const result = adminAuditEntrySchema.parse(entry({ reason: null }));

      expect(result.reason).toBeNull();
    });

    it('đủ trường: lý do và meta giữ nguyên giá trị hợp lệ', () => {
      const conversationId = randomUUID();

      const result = adminAuditEntrySchema.parse(
        entry({
          reason: 'Báo cáo quấy rối',
          meta: {
            conversationId,
            from: 'ACTIVE',
            cancelled: 3,
            notified: true,
          },
        }),
      );

      expect(result.reason).toBe('Báo cáo quấy rối');
      expect(result.meta).toEqual({
        conversationId,
        from: 'ACTIVE',
        cancelled: 3,
        notified: true,
      });
    });
  });

  describe('từ chối', () => {
    it.each([
      ['hành động không có trong danh sách', { action: 'DELETE_EVERYTHING' }],
      ['hành động viết thường', { action: 'suspend_user' }],
      ['loại đối tượng không có trong danh sách', { targetType: 'ORDER' }],
      ['actorId không phải UUID', { actorId: 'admin-1' }],
      ['targetId không phải UUID', { targetId: 'user-1' }],
      ['targetId rỗng', { targetId: '' }],
    ])('%s', (_name, overrides) => {
      const result = adminAuditEntrySchema.safeParse(
        entry(overrides as Partial<AdminAuditEntryInput>),
      );

      expect(result.success).toBe(false);
    });

    it('thiếu actorId, action, targetType hoặc targetId', () => {
      for (const key of ['actorId', 'action', 'targetType', 'targetId']) {
        const { [key]: _omitted, ...rest } = entry() as Record<string, unknown>;

        expect(adminAuditEntrySchema.safeParse(rest).success).toBe(false);
      }
    });

    it('cặp (hành động, loại đối tượng) lệch nhau — ví dụ đọc chat lên một shop — kèm đường dẫn targetType', () => {
      const result = adminAuditEntrySchema.safeParse(
        entry({ targetType: 'SHOP' }, 'CHAT_ACCESSED'),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].path).toEqual(['targetType']);
      }
    });

    it.each(
      ADMIN_AUDIT_ACTIONS.flatMap((action) =>
        ADMIN_AUDIT_TARGET_TYPES.filter(
          (type) => type !== ADMIN_AUDIT_ACTION_TARGETS[action],
        ).map((type) => [action, type] as const),
      ),
    )('hành động %s lên loại %s', (action, targetType) => {
      const result = adminAuditEntrySchema.safeParse(
        entry({ targetType }, action),
      );

      expect(result.success).toBe(false);
    });

    it.each(['id', 'createdAt', 'userId', 'extra'])(
      'khoá lạ "%s" (không ai nhét thêm cột)',
      (key) => {
        const result = adminAuditEntrySchema.safeParse({
          ...entry(),
          [key]: randomUUID(),
        });

        expect(result.success).toBe(false);
      },
    );
  });
});

describe('lý do (adminAuditReasonSchema)', () => {
  it('cắt khoảng trắng hai đầu và chuẩn hoá CRLF/CR thành LF', () => {
    expect(adminAuditReasonSchema.parse('  dòng 1\r\ndòng 2\rdòng 3  ')).toBe(
      'dòng 1\ndòng 2\ndòng 3',
    );
  });

  it('đúng giới hạn thì qua, hơn một ký tự thì bị từ chối', () => {
    const exact = 'a'.repeat(ADMIN_AUDIT_REASON_MAX_LENGTH);

    expect(adminAuditReasonSchema.safeParse(exact).success).toBe(true);
    expect(adminAuditReasonSchema.safeParse(`${exact}a`).success).toBe(false);
  });

  it.each([
    ['chuỗi rỗng', ''],
    ['chỉ có khoảng trắng', ' \n\t '],
    ['có NUL', `lý do${NUL}`],
    ['có bidi-override', `lý do${BIDI_OVERRIDE}`],
    ['có dấu phân dòng Unicode', `lý do${LINE_SEPARATOR}khác`],
    ['có tab', 'lý\tdo'],
  ])('từ chối lý do %s', (_name, value) => {
    expect(adminAuditReasonSchema.safeParse(value).success).toBe(false);
  });

  it('không phải chuỗi (số, object) bị từ chối', () => {
    expect(adminAuditReasonSchema.safeParse(42).success).toBe(false);
    expect(adminAuditReasonSchema.safeParse({}).success).toBe(false);
  });

  it('lý do chứa <img onerror> được giữ NGUYÊN VĂN như chữ (React escape khi hiển thị)', () => {
    const reason = '<img src=x onerror=alert(1)>';

    expect(adminAuditReasonSchema.parse(reason)).toBe(reason);
  });
});

describe('meta (adminAuditMetaSchema)', () => {
  describe('chỉ nhận id, mã dạng enum, số đếm và cờ', () => {
    it.each([
      ['UUID', { targetId: randomUUID() }],
      ['mã dạng enum', { to: 'SUSPENDED' }],
      ['mã enum có số và gạch dưới', { code: 'ORDER_2_PAID' }],
      ['số đếm 0', { cancelled: 0 }],
      ['số đếm lớn', { cancelled: Number.MAX_SAFE_INTEGER }],
      ['cờ true', { notified: true }],
      ['cờ false', { notified: false }],
      ['object rỗng', {}],
    ])('chấp nhận %s', (_name, meta) => {
      expect(adminAuditMetaSchema.safeParse(meta).success).toBe(true);
    });

    it.each([
      ['chữ tự do', { note: 'khách hàng nói xấu shop' }],
      ['email', { email: 'a@b.vn' }],
      ['mã enum viết thường', { to: 'suspended' }],
      ['mã enum bắt đầu bằng số', { to: '1ST' }],
      ['mã enum quá 40 ký tự', { to: 'A'.repeat(41) }],
      ['chuỗi rỗng', { to: '' }],
      ['số âm', { count: -1 }],
      ['số thập phân', { count: 1.5 }],
      ['số vượt ngưỡng an toàn', { count: Number.MAX_SAFE_INTEGER + 2 }],
      ['NaN', { count: NaN }],
      ['Infinity', { count: Infinity }],
      ['null', { count: null }],
      ['object lồng nhau', { nested: { a: 1 } }],
      ['mảng', { list: [1, 2] }],
    ])('từ chối %s', (_name, meta) => {
      expect(adminAuditMetaSchema.safeParse(meta).success).toBe(false);
    });

    it.each([
      ['khoá có dấu gạch ngang', { 'a-b': 1 }],
      ['khoá bắt đầu bằng số', { '1a': 1 }],
      ['khoá có khoảng trắng', { 'a b': 1 }],
      ['khoá rỗng', { '': 1 }],
      ['khoá quá 40 ký tự', { ['a'.repeat(41)]: 1 }],
    ])('từ chối %s', (_name, meta) => {
      expect(adminAuditMetaSchema.safeParse(meta).success).toBe(false);
    });

    it('mảng hoặc giá trị thuần không phải object bị từ chối', () => {
      for (const value of [[], 'x', 1, true, null]) {
        expect(adminAuditMetaSchema.safeParse(value).success).toBe(false);
      }
    });
  });

  describe('giới hạn số khoá và kích thước', () => {
    const keyOf = (i: number) =>
      `${'k'.repeat(38)}${String(i).padStart(2, '0')}`;
    // `count` khoá dài 40 ký tự, mỗi giá trị là mã enum dài `valueLength` ký tự.
    const metaOf = (count: number, valueLength: number | number[]) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          keyOf(i),
          'A'.repeat(Array.isArray(valueLength) ? valueLength[i] : valueLength),
        ]),
      );
    const bytes = (meta: object) => Buffer.byteLength(JSON.stringify(meta));

    it(`đúng ${ADMIN_AUDIT_META_MAX_KEYS} khoá thì qua, nhiều hơn một khoá thì bị từ chối`, () => {
      expect(
        adminAuditMetaSchema.safeParse(metaOf(ADMIN_AUDIT_META_MAX_KEYS, 1))
          .success,
      ).toBe(true);
      expect(
        adminAuditMetaSchema.safeParse(metaOf(ADMIN_AUDIT_META_MAX_KEYS + 1, 1))
          .success,
      ).toBe(false);
    });

    it('JSON gọn đúng 1024 byte thì qua, 1025 byte thì bị từ chối (đo bằng Buffer.byteLength)', () => {
      // 12 khoá dài 40 ký tự + 12 mã enum dài 40 ký tự = 1033 byte; bớt 9 ký tự ở giá trị đầu để đúng cận.
      const full = new Array<number>(ADMIN_AUDIT_META_MAX_KEYS).fill(40);
      expect(bytes(metaOf(ADMIN_AUDIT_META_MAX_KEYS, full))).toBe(1033);
      const atLimit = metaOf(ADMIN_AUDIT_META_MAX_KEYS, [31, ...full.slice(1)]);
      const overLimit = metaOf(ADMIN_AUDIT_META_MAX_KEYS, [
        32,
        ...full.slice(1),
      ]);

      expect(bytes(atLimit)).toBe(ADMIN_AUDIT_META_MAX_BYTES);
      expect(bytes(overLimit)).toBe(ADMIN_AUDIT_META_MAX_BYTES + 1);
      expect(adminAuditMetaSchema.safeParse(atLimit).success).toBe(true);
      expect(adminAuditMetaSchema.safeParse(overLimit).success).toBe(false);
    });
  });
});

describe('nguồn của request (ip, userAgent)', () => {
  describe('ip', () => {
    it.each([
      ['IPv4', '203.0.113.7'],
      ['IPv6 rút gọn', '2001:db8::1'],
      ['IPv6 loopback', '::1'],
      ['IPv4 ánh xạ vào IPv6', '::ffff:203.0.113.7'],
    ])('chấp nhận %s', (_name, ip) => {
      expect(adminAuditIpSchema.safeParse(ip).success).toBe(true);
    });

    it.each([
      ['rỗng', ''],
      ['không phải địa chỉ', 'not-an-ip'],
      ['octet vượt 255', '999.1.1.1'],
      ['có khoảng trắng thừa', '203.0.113.7 '],
      ['chứa HTML', '<script>alert(1)</script>'],
      ['quá 45 ký tự', `2001:db8::${'1'.repeat(40)}`],
    ])('từ chối %s', (_name, ip) => {
      expect(adminAuditIpSchema.safeParse(ip).success).toBe(false);
    });

    it('IPv6 viết đầy đủ 8 nhóm (39 ký tự) và IPv4 ánh xạ dài nhất đều vừa giới hạn độ dài', () => {
      for (const ip of [
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        '::ffff:255.255.255.255',
      ]) {
        expect(ip.length).toBeLessThanOrEqual(ADMIN_AUDIT_IP_MAX_LENGTH);
        expect(adminAuditIpSchema.safeParse(ip).success).toBe(true);
      }
    });

    it('dạng viết đầy đủ 45 ký tự (0000:…:ffff:255.255.255.255) bị Zod từ chối — chặt hơn CHECK của DB, chấp nhận được vì Node/Express luôn trả dạng rút gọn', () => {
      const fullForm = '0000:0000:0000:0000:0000:ffff:255.255.255.255';

      expect(fullForm).toHaveLength(ADMIN_AUDIT_IP_MAX_LENGTH);
      expect(adminAuditIpSchema.safeParse(fullForm).success).toBe(false);
    });
  });

  describe('userAgent', () => {
    it('đúng giới hạn thì qua, hơn một ký tự thì bị từ chối', () => {
      const exact = 'a'.repeat(ADMIN_AUDIT_USER_AGENT_MAX_LENGTH);

      expect(adminAuditUserAgentSchema.safeParse(exact).success).toBe(true);
      expect(adminAuditUserAgentSchema.safeParse(`${exact}a`).success).toBe(
        false,
      );
    });

    it.each([
      ['rỗng', ''],
      ['có xuống dòng', 'Mozilla/5.0\nX-Injected: 1'],
      ['có NUL', `Mozilla${NUL}`],
      ['có bidi-override', `Mozilla${BIDI_OVERRIDE}`],
      ['có dấu phân dòng Unicode', `Mozilla${LINE_SEPARATOR}5.0`],
    ])('từ chối User-Agent %s', (_name, value) => {
      expect(adminAuditUserAgentSchema.safeParse(value).success).toBe(false);
    });

    it('User-Agent trình duyệt thật được chấp nhận', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

      expect(adminAuditUserAgentSchema.safeParse(ua).success).toBe(true);
    });
  });

  describe('trong mục nhật ký', () => {
    it('cả hai tuỳ chọn: có thể thiếu, null hoặc đủ', () => {
      for (const overrides of [
        {},
        { ip: null, userAgent: null },
        { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      ]) {
        expect(adminAuditEntrySchema.safeParse(entry(overrides)).success).toBe(
          true,
        );
      }
    });

    it('ip hoặc userAgent sai thì cả mục bị từ chối (không lặng lẽ bỏ trường)', () => {
      expect(
        adminAuditEntrySchema.safeParse(entry({ ip: 'not-an-ip' })).success,
      ).toBe(false);
      expect(
        adminAuditEntrySchema.safeParse(entry({ userAgent: 'a\nb' })).success,
      ).toBe(false);
    });
  });
});

describe('khớp với DB', () => {
  const migrationSql = () => {
    const migrationsDir = join(
      __dirname,
      '..',
      '..',
      '..',
      'prisma',
      'migrations',
    );
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_admin_audit_logs'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };

  it('ADMIN_AUDIT_REASON_MAX_LENGTH bằng cận trên của CHECK reason (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const match = /char_length\("reason"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(ADMIN_AUDIT_REASON_MAX_LENGTH);
  });

  it('CHECK kích thước meta của DB bằng đúng 2 × ADMIN_AUDIT_META_MAX_BYTES (jsonb::text dài hơn JSON gọn)', () => {
    const match = /octet_length\("meta"::text\)\s*<=\s*(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(ADMIN_AUDIT_META_MAX_BYTES * 2);
  });

  it('mọi hành động hợp lệ qua CHECK dạng của cột action; chữ thường và quá dài thì không', () => {
    const match = /"action"\s*~\s*'([^']+)'/.exec(migrationSql());
    expect(match).not.toBeNull();
    const pattern = new RegExp(match?.[1] as string);

    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(action).toMatch(pattern);
    }
    expect('suspend_user').not.toMatch(pattern);
    expect('A'.repeat(65)).not.toMatch(pattern);
    expect('A'.repeat(64)).toMatch(pattern);
  });

  it('mọi loại đối tượng hợp lệ qua CHECK dạng của cột target_type', () => {
    const match = /"target_type"\s*~\s*'([^']+)'/.exec(migrationSql());
    expect(match).not.toBeNull();
    const pattern = new RegExp(match?.[1] as string);

    for (const type of ADMIN_AUDIT_TARGET_TYPES) {
      expect(type).toMatch(pattern);
    }
    expect('user').not.toMatch(pattern);
    expect('A'.repeat(33)).not.toMatch(pattern);
  });

  it('ADMIN_AUDIT_IP_MAX_LENGTH và ADMIN_AUDIT_USER_AGENT_MAX_LENGTH bằng cận trên của CHECK ip và user_agent', () => {
    const ip =
      /"ip"\s+IS NULL OR char_length\("ip"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        migrationSql(),
      );
    const userAgent =
      /"user_agent"\s+IS NULL OR char_length\("user_agent"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        migrationSql(),
      );

    expect(Number(ip?.[1])).toBe(ADMIN_AUDIT_IP_MAX_LENGTH);
    expect(Number(userAgent?.[1])).toBe(ADMIN_AUDIT_USER_AGENT_MAX_LENGTH);
  });

  it('UUID (36 ký tự) nằm gọn trong CHECK độ dài target_id', () => {
    const match = /char_length\("target_id"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(randomUUID().length).toBeLessThanOrEqual(Number(match?.[1]));
  });
});
