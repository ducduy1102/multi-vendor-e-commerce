import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { deleteAdminAuditLogsForTests } from '../testing/admin-audit-cleanup';
import { cleanupByTag, createUser } from '../testing/db-fixtures';
import {
  AdminAuditService,
  InvalidAdminAuditEntryError,
} from './admin-audit.service';

// Integration test trên Postgres THẬT cho nhật ký quản trị (Week11.md 2.3). Chứng minh điều unit test với client giả
// không chứng minh được: dòng nhật ký commit/rollback CÙNG transaction nghiệp vụ, các CHECK ở DB đúng kể cả khi đi vòng
// qua service (lưới an toàn cuối), nhật ký không bị xoá theo tài khoản, và các truy vấn lịch sử được chỉ mục phục vụ.
// Chạy: `pnpm test:int`.
const TAG = 'it-audit-';
// Tiền tố riêng cho ca kiểm cleanupByTag (không bắt đầu bằng TAG, kẻo cleanupByTag(TAG) dọn lẫn dữ liệu của ca đó).
const CLEANUP_TAG = 'it-auditcl-';

describe('AdminAuditService + bảng admin_audit_logs (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new AdminAuditService();
  // Không phải người dùng thật có chủ đích: bảng không có khoá ngoại tới users (kiểm ở nhóm "không có khoá ngoại").
  const ACTOR = randomUUID();
  const extraActors: string[] = [];

  // Ghi thẳng bằng Prisma (đi VÒNG qua service) để thử các CHECK với giá trị mà Zod không bao giờ cho qua.
  const insert = (
    overrides: Partial<Prisma.AdminAuditLogUncheckedCreateInput> = {},
  ) =>
    prisma.adminAuditLog.create({
      data: {
        actorId: ACTOR,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId: randomUUID(),
        ...overrides,
      },
    });

  const rowsOf = (targetId: string) =>
    prisma.adminAuditLog.findMany({ where: { targetId } });

  // Độ dài văn bản của jsonb (cái mà CHECK đo): {"k": "<n ký tự>"} có thêm 9 byte cố định (7 đầu + 2 cuối).
  const labelOfBytes = (total: number) => 'a'.repeat(total - 9);

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
  });

  afterAll(async () => {
    // Bảng chỉ thêm ngay ở DB nên một deleteMany thường sẽ bị trigger từ chối: dọn qua helper của test.
    await deleteAdminAuditLogsForTests(prisma, {
      actorId: { in: [ACTOR, ...extraActors] },
    });
    await cleanupByTag(prisma, TAG);
    await cleanupByTag(prisma, CLEANUP_TAG);
    await prisma.$disconnect();
  });

  describe('ghi một mục', () => {
    it('ghi đủ cột: id UUID, mốc tạo, lý do NULL và meta {} khi không truyền', async () => {
      const targetId = randomUUID();

      await service.record(prisma, {
        actorId: ACTOR,
        action: 'CHAT_ACCESSED',
        targetType: 'CONVERSATION',
        targetId,
      });

      const [row] = await rowsOf(targetId);
      expect(row).toMatchObject({
        actorId: ACTOR,
        action: 'CHAT_ACCESSED',
        targetType: 'CONVERSATION',
        targetId,
        reason: null,
        meta: {},
      });
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('lý do nhiều dòng có dấu và meta được lưu nguyên vẹn', async () => {
      const targetId = randomUUID();
      const reportId = randomUUID();

      await service.record(prisma, {
        actorId: ACTOR,
        action: 'RESOLVE_REPORT',
        targetType: 'REPORT',
        targetId,
        reason: 'Đánh giá chứa ngôn từ xúc phạm.\nĐã ẩn.',
        meta: {
          reportId,
          decision: 'HIDE_REVIEW',
          cancelled: 2,
          notified: true,
        },
      });

      const [row] = await rowsOf(targetId);
      expect(row.reason).toBe('Đánh giá chứa ngôn từ xúc phạm.\nĐã ẩn.');
      expect(row.meta).toEqual({
        reportId,
        decision: 'HIDE_REVIEW',
        cancelled: 2,
        notified: true,
      });
    });

    it('cột meta có mặc định {} ở chính DB (INSERT không nhắc tới meta)', async () => {
      const id = randomUUID();
      const targetId = randomUUID();

      await prisma.$executeRaw`
        INSERT INTO admin_audit_logs (id, actor_id, action, target_type, target_id)
        VALUES (${id}, ${ACTOR}, 'SUSPEND_USER', 'USER', ${targetId})`;

      const [row] = await rowsOf(targetId);
      expect(row.meta).toEqual({});
      expect(row.reason).toBeNull();
      expect(row.ip).toBeNull();
      expect(row.userAgent).toBeNull();
    });

    it('lưu IP và User-Agent của request khi được truyền; không truyền thì NULL', async () => {
      const withContext = randomUUID();
      const without = randomUUID();
      const entry = {
        actorId: ACTOR,
        action: 'SUSPEND_USER',
        targetType: 'USER',
      } as const;

      await service.record(prisma, {
        ...entry,
        targetId: withContext,
        ip: '2001:db8::1',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      });
      await service.record(prisma, { ...entry, targetId: without });

      const [row] = await rowsOf(withContext);
      expect(row).toMatchObject({
        ip: '2001:db8::1',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      });
      const [bare] = await rowsOf(without);
      expect(bare).toMatchObject({ ip: null, userAgent: null });
    });

    it('mục sai hình dạng bị từ chối TRƯỚC khi chạm DB: không có dòng nào được ghi', async () => {
      const targetId = randomUUID();

      await expect(
        service.record(prisma, {
          actorId: ACTOR,
          action: 'CHAT_ACCESSED',
          targetType: 'SHOP',
          targetId,
        }),
      ).rejects.toBeInstanceOf(InvalidAdminAuditEntryError);

      expect(await rowsOf(targetId)).toHaveLength(0);
    });
  });

  describe('cùng transaction với thay đổi nghiệp vụ', () => {
    const entryFor = (targetId: string) =>
      ({
        actorId: ACTOR,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId,
        reason: 'Vi phạm điều khoản',
      }) as const;

    it('commit: thay đổi nghiệp vụ và dòng nhật ký cùng xuất hiện', async () => {
      const user = await createUser(prisma, TAG);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { name: `${TAG}committed` },
        });
        await service.record(tx, entryFor(user.id));
      });

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name,
      ).toBe(`${TAG}committed`);
      expect(await rowsOf(user.id)).toHaveLength(1);
    });

    it('rollback: transaction thất bại SAU khi ghi nhật ký ⇒ không còn dòng nhật ký lẫn thay đổi nghiệp vụ', async () => {
      const user = await createUser(prisma, TAG);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { name: `${TAG}rolled-back` },
          });
          await service.record(tx, entryFor(user.id));
          throw new Error('nghiệp vụ thất bại sau khi ghi nhật ký');
        }),
      ).rejects.toThrow('nghiệp vụ thất bại');

      expect(await rowsOf(user.id)).toHaveLength(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name,
      ).toBe(`${TAG}user`);
    });

    it('fail-closed: mục nhật ký sai hình dạng làm CẢ transaction rollback (hành động không dấu vết thì không xảy ra)', async () => {
      const user = await createUser(prisma, TAG);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { name: `${TAG}no-trace` },
          });
          await service.record(tx, {
            ...entryFor(user.id),
            targetType: 'SHOP',
          });
        }),
      ).rejects.toBeInstanceOf(InvalidAdminAuditEntryError);

      expect(await rowsOf(user.id)).toHaveLength(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name,
      ).toBe(`${TAG}user`);
    });

    it('dòng nhật ký ghi qua tx chưa nhìn thấy được từ ngoài transaction cho tới khi commit', async () => {
      const user = await createUser(prisma, TAG);
      let visibleFromOutside = -1;

      await prisma.$transaction(async (tx) => {
        await service.record(tx, entryFor(user.id));
        visibleFromOutside = (await rowsOf(user.id)).length;
        expect(
          await tx.adminAuditLog.count({ where: { targetId: user.id } }),
        ).toBe(1);
      });

      expect(visibleFromOutside).toBe(0);
      expect(await rowsOf(user.id)).toHaveLength(1);
    });
  });

  describe('CHECK ở DB (đi vòng qua service)', () => {
    describe('action: IN_HOA_GẠCH_DƯỚI, 1..64 ký tự', () => {
      it.each([
        ['rỗng', ''],
        ['viết thường', 'suspend_user'],
        ['bắt đầu bằng số', '1SUSPEND'],
        ['có dấu gạch ngang', 'SUSPEND-USER'],
        ['có khoảng trắng', 'SUSPEND USER'],
        ['65 ký tự', 'A'.repeat(65)],
        ['có xuống dòng ở cuối', 'SUSPEND_USER\n'],
      ])('từ chối action %s', async (_name, action) => {
        await expect(insert({ action })).rejects.toThrow(
          /admin_audit_logs_action_format|constraint/i,
        );
      });

      it.each([
        ['1 ký tự', 'A'],
        ['đúng 64 ký tự', 'A'.repeat(64)],
        ['có số và gạch dưới', 'ORDER_2_PAID'],
      ])('chấp nhận action %s', async (_name, action) => {
        await expect(insert({ action })).resolves.toMatchObject({ action });
      });
    });

    describe('target_type: IN_HOA_GẠCH_DƯỚI, 1..32 ký tự', () => {
      it.each([
        ['rỗng', ''],
        ['viết thường', 'user'],
        ['33 ký tự', 'A'.repeat(33)],
      ])('từ chối target_type %s', async (_name, targetType) => {
        await expect(insert({ targetType })).rejects.toThrow(
          /admin_audit_logs_target_type_format|constraint/i,
        );
      });

      it('chấp nhận đúng 32 ký tự', async () => {
        const targetType = 'A'.repeat(32);

        await expect(insert({ targetType })).resolves.toMatchObject({
          targetType,
        });
      });
    });

    describe('target_id: 1..64 ký tự', () => {
      it.each([
        ['rỗng', ''],
        ['65 ký tự', 'a'.repeat(65)],
      ])('từ chối target_id %s', async (_name, targetId) => {
        await expect(insert({ targetId })).rejects.toThrow(
          /admin_audit_logs_target_id_length_in_range|constraint/i,
        );
      });

      it('chấp nhận đúng 64 ký tự', async () => {
        const targetId = 'a'.repeat(64);

        await expect(insert({ targetId })).resolves.toMatchObject({ targetId });
      });
    });

    describe('reason: NULL hoặc 1..500 ký tự', () => {
      it.each([
        ['rỗng (khác NULL)', ''],
        ['501 ký tự', 'a'.repeat(501)],
      ])('từ chối lý do %s', async (_name, reason) => {
        await expect(insert({ reason })).rejects.toThrow(
          /admin_audit_logs_reason_length_in_range|constraint/i,
        );
      });

      it('chấp nhận NULL, 1 ký tự và đúng 500 ký tự', async () => {
        await expect(insert({ reason: null })).resolves.toMatchObject({
          reason: null,
        });
        await expect(insert({ reason: 'a' })).resolves.toMatchObject({
          reason: 'a',
        });
        await expect(
          insert({ reason: 'a'.repeat(500) }),
        ).resolves.toBeDefined();
      });

      it('đếm KÝ TỰ chứ không đếm byte: 500 chữ "é" (1000 byte) qua, 501 thì không', async () => {
        await expect(
          insert({ reason: 'é'.repeat(500) }),
        ).resolves.toBeDefined();
        await expect(insert({ reason: 'é'.repeat(501) })).rejects.toThrow(
          /admin_audit_logs_reason_length_in_range|constraint/i,
        );
      });
    });

    describe('meta: JSON object, tối đa 2048 byte văn bản jsonb', () => {
      it.each([
        ['mảng', []],
        ['chuỗi', 'ORDER_NEW'],
        ['số', 42],
        ['boolean', true],
      ])('từ chối meta là %s', async (_name, meta) => {
        await expect(
          insert({ meta: meta as Prisma.InputJsonValue }),
        ).rejects.toThrow(/admin_audit_logs_meta_is_object|constraint/i);
      });

      it('từ chối JSON null (khác với NULL của SQL)', async () => {
        await expect(insert({ meta: Prisma.JsonNull })).rejects.toThrow(
          /admin_audit_logs_meta_is_object|constraint/i,
        );
      });

      it('đúng 2048 byte thì qua, 2049 byte thì bị từ chối (đo bằng octet_length trên chính hàng đã ghi)', async () => {
        const ok = await insert({ meta: { k: labelOfBytes(2048) } });
        const [measured] = await prisma.$queryRaw<{ bytes: number }[]>`
          SELECT octet_length(meta::text)::int AS bytes FROM admin_audit_logs WHERE id = ${ok.id}`;

        expect(measured.bytes).toBe(2048);
        await expect(
          insert({ meta: { k: labelOfBytes(2049) } }),
        ).rejects.toThrow(/admin_audit_logs_meta_size_limit|constraint/i);
      });

      it('meta lớn nhất mà Zod cho phép (12 khoá dài 40 ký tự, giá trị 40 ký tự, JSON gọn ≤ 1024 byte) luôn qua CHECK dù jsonb::text dài hơn', async () => {
        // 12 khoá + 12 giá trị: jsonb::text thêm dấu cách sau mỗi ':' và ',' nên dài hơn JSON gọn.
        const meta: Record<string, string> = {};
        for (let i = 0; i < 12; i++) {
          meta[`${'k'.repeat(38)}${String(i).padStart(2, '0')}`] =
            i === 0 ? 'A'.repeat(31) : 'A'.repeat(40);
        }
        expect(Buffer.byteLength(JSON.stringify(meta))).toBe(1024);
        const targetId = randomUUID();

        await service.record(prisma, {
          actorId: ACTOR,
          action: 'SUSPEND_USER',
          targetType: 'USER',
          targetId,
          meta,
        });

        const [row] = await rowsOf(targetId);
        expect(row.meta).toEqual(meta);
      });
    });
  });

  describe('CHECK ip và user_agent (đi vòng qua service)', () => {
    it.each([
      ['ip rỗng', { ip: '' }],
      ['ip 46 ký tự', { ip: 'a'.repeat(46) }],
      ['user_agent rỗng', { userAgent: '' }],
      ['user_agent 257 ký tự', { userAgent: 'a'.repeat(257) }],
    ])('từ chối %s', async (_name, overrides) => {
      await expect(insert(overrides)).rejects.toThrow(
        /admin_audit_logs_(ip|user_agent)_length_in_range|constraint/i,
      );
    });

    it('chấp nhận NULL, ip đúng 45 ký tự và user_agent đúng 256 ký tự', async () => {
      await expect(
        insert({ ip: null, userAgent: null }),
      ).resolves.toBeDefined();
      await expect(insert({ ip: 'a'.repeat(45) })).resolves.toBeDefined();
      await expect(
        insert({ userAgent: 'a'.repeat(256) }),
      ).resolves.toBeDefined();
    });
  });

  describe('chỉ thêm ngay ở DB (trigger)', () => {
    const APPEND_ONLY = /admin_audit_logs is append-only/;

    it('UPDATE/DELETE bằng Prisma đều bị từ chối và dòng giữ nguyên', async () => {
      const row = await insert({ reason: 'gốc' });

      await expect(
        prisma.adminAuditLog.update({
          where: { id: row.id },
          data: { reason: 'đã sửa' },
        }),
      ).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.adminAuditLog.updateMany({
          where: { id: row.id },
          data: { reason: 'đã sửa' },
        }),
      ).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.adminAuditLog.delete({ where: { id: row.id } }),
      ).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.adminAuditLog.deleteMany({ where: { id: row.id } }),
      ).rejects.toThrow(APPEND_ONLY);

      const after = await prisma.adminAuditLog.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.reason).toBe('gốc');
    });

    it('SQL thô UPDATE/DELETE cũng bị từ chối (đúng thứ test quét mã nguồn không bắt được)', async () => {
      const row = await insert({ reason: 'gốc' });

      await expect(
        prisma.$executeRaw`UPDATE admin_audit_logs SET reason = 'đã sửa' WHERE id = ${row.id}`,
      ).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.$executeRaw`DELETE FROM admin_audit_logs WHERE id = ${row.id}`,
      ).rejects.toThrow(APPEND_ONLY);

      expect(await rowsOf(row.targetId)).toHaveLength(1);
    });

    it('TRUNCATE bị từ chối (chạy trong transaction rồi rollback: nếu trigger hỏng cũng không mất dữ liệu của DB đang dùng)', async () => {
      const row = await insert();

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('TRUNCATE TABLE admin_audit_logs');
          throw new Error('rollback-sentinel');
        }),
      ).rejects.toThrow(APPEND_ONLY);

      expect(await rowsOf(row.targetId)).toHaveLength(1);
    });

    it('INSERT vẫn bình thường', async () => {
      await expect(insert()).resolves.toBeDefined();
    });

    it('lối thoát dành cho test: cờ cục bộ trong transaction cho phép xoá, và cờ KHÔNG rò sang transaction khác', async () => {
      const first = await insert();
      const second = await insert();

      expect(await deleteAdminAuditLogsForTests(prisma, { id: first.id })).toBe(
        1,
      );
      expect(await rowsOf(first.targetId)).toHaveLength(0);
      // Lặp nhiều lần để có khả năng cao cùng một kết nối trong pool được dùng lại: cờ phải đã hết hiệu lực.
      for (let i = 0; i < 10; i++) {
        const [{ flag }] = await prisma.$queryRaw<{ flag: string | null }[]>`
          SELECT current_setting('app.allow_audit_cleanup', true) AS flag`;
        expect(flag === null || flag === '').toBe(true);
      }
      await expect(
        prisma.adminAuditLog.deleteMany({ where: { id: second.id } }),
      ).rejects.toThrow(APPEND_ONLY);
    });

    it('với cờ bật, UPDATE cũng được phép (cờ là lối thoát duy nhất, không chỉ cho DELETE)', async () => {
      const row = await insert({ reason: 'gốc' });

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.allow_audit_cleanup', 'on', true)`;
        await tx.adminAuditLog.update({
          where: { id: row.id },
          data: { reason: 'đã sửa' },
        });
      });

      const after = await prisma.adminAuditLog.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.reason).toBe('đã sửa');
    });

    it.each([['off'], ['true'], ['1'], ['ON '], ['']])(
      'cờ mang giá trị %p không mở lối thoát (chỉ đúng chữ "on")',
      async (value) => {
        const row = await insert();

        await expect(
          prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('app.allow_audit_cleanup', ${value}, true)`;
            await tx.adminAuditLog.delete({ where: { id: row.id } });
          }),
        ).rejects.toThrow(APPEND_ONLY);

        expect(await rowsOf(row.targetId)).toHaveLength(1);
      },
    );
  });

  describe('giờ do đồng hồ DB đóng dấu (UTC)', () => {
    const dbNow = async () => {
      const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`
        SELECT timezone('UTC', clock_timestamp()) AS now`;
      return now.getTime();
    };

    it('created_at nằm giữa hai lần đọc đồng hồ DB quanh câu INSERT (sai số làm tròn 1 ms của TIMESTAMP(3))', async () => {
      const before = await dbNow();
      const row = await insert();
      const after = await dbNow();

      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1);
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(after + 1);
    });

    it('không phụ thuộc múi giờ của phiên DB: đặt TimeZone = Asia/Ho_Chi_Minh (+7) thì giờ ghi vẫn là UTC', async () => {
      const id = randomUUID();
      const targetId = randomUUID();
      const before = await dbNow();

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh'");
        await tx.$executeRaw`
          INSERT INTO admin_audit_logs (id, actor_id, action, target_type, target_id)
          VALUES (${id}, ${ACTOR}, 'SUSPEND_USER', 'USER', ${targetId})`;
      });

      const [row] = await rowsOf(targetId);
      const after = await dbNow();
      // Nếu mặc định phụ thuộc múi giờ phiên, giá trị sẽ lệch +7 giờ (25.200.000 ms).
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1);
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(after + 1);
    });

    it('hai dòng ghi trong CÙNG một transaction có giờ khác nhau và đúng thứ tự (clock_timestamp, không phải now())', async () => {
      const first = randomUUID();
      const second = randomUUID();
      const entry = {
        actorId: ACTOR,
        action: 'SUSPEND_USER',
        targetType: 'USER',
      } as const;

      await prisma.$transaction(async (tx) => {
        await service.record(tx, { ...entry, targetId: first });
        await new Promise((resolve) => setTimeout(resolve, 25));
        await service.record(tx, { ...entry, targetId: second });
      });

      const [a] = await rowsOf(first);
      const [b] = await rowsOf(second);
      expect(b.createdAt.getTime()).toBeGreaterThan(a.createdAt.getTime());
    });

    it('client không đặt được giờ: createdAt không nằm trong mục nhật ký', async () => {
      await expect(
        service.record(prisma, {
          actorId: ACTOR,
          action: 'SUSPEND_USER',
          targetType: 'USER',
          targetId: randomUUID(),
          createdAt: new Date('2000-01-01'),
        } as never),
      ).rejects.toBeInstanceOf(InvalidAdminAuditEntryError);
    });
  });

  describe('không có khoá ngoại tới users (có chủ đích)', () => {
    it('ghi được dòng với actorId không phải người dùng nào (nơi gọi lấy actorId từ phiên đã xác thực)', async () => {
      const stranger = randomUUID();
      extraActors.push(stranger);

      await expect(insert({ actorId: stranger })).resolves.toBeDefined();
    });

    it('xoá tài khoản Admin KHÔNG xoá dấu vết các việc họ đã làm', async () => {
      const admin = await createUser(prisma, TAG);
      extraActors.push(admin.id);
      const targetId = randomUUID();
      await service.record(prisma, {
        actorId: admin.id,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId,
        reason: 'Vi phạm điều khoản',
      });

      await prisma.user.delete({ where: { id: admin.id } });

      const rows = await rowsOf(targetId);
      expect(rows).toHaveLength(1);
      expect(rows[0].actorId).toBe(admin.id);
    });
  });

  describe('cleanupByTag dọn nhật ký của spec', () => {
    it('xoá dòng do người dùng có tiền tố thực hiện và dòng nói về người dùng/shop có tiền tố; giữ nguyên dòng không liên quan', async () => {
      const localTag = CLEANUP_TAG;
      await cleanupByTag(prisma, localTag);
      const admin = await createUser(prisma, localTag);
      const subject = await createUser(prisma, localTag);
      const owner = await createUser(prisma, localTag);
      const shop = await prisma.shop.create({
        data: {
          ownerId: owner.id,
          name: `${localTag}shop`,
          slug: `${localTag}shop-1`,
        },
        select: { id: true },
      });
      const unrelatedTarget = randomUUID();
      const byTaggedActor = randomUUID();
      const record = (
        actorId: string,
        targetType: 'USER' | 'SHOP',
        targetId: string,
      ) =>
        service.record(prisma, {
          actorId,
          action:
            targetType === 'USER' ? 'SUSPEND_USER' : 'CANCEL_SHOP_OPEN_ORDERS',
          targetType,
          targetId,
        });
      await record(admin.id, 'USER', byTaggedActor);
      await record(ACTOR, 'USER', subject.id);
      await record(ACTOR, 'SHOP', shop.id);
      await record(ACTOR, 'USER', unrelatedTarget);

      await cleanupByTag(prisma, localTag);

      expect(await rowsOf(byTaggedActor)).toHaveLength(0);
      expect(await rowsOf(subject.id)).toHaveLength(0);
      expect(await rowsOf(shop.id)).toHaveLength(0);
      expect(await rowsOf(unrelatedTarget)).toHaveLength(1);
    });
  });

  describe('chỉ mục theo thiết kế', () => {
    it('có đúng hai chỉ mục thiết kế (cộng khoá chính), không chỉ mục đơn dư thừa', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'admin_audit_logs'`;

      expect(rows.map((r) => r.indexname).sort()).toEqual([
        'admin_audit_logs_actor_id_created_at_id_idx',
        'admin_audit_logs_pkey',
        'admin_audit_logs_target_type_target_id_created_at_id_idx',
      ]);
    });

    it('lịch sử của một đối tượng và việc của một Admin đều được phục vụ bằng quét chỉ mục, KHÔNG sắp xếp lại', async () => {
      // Bảng chỉ có vài hàng nên planner tự do chọn quét bất kỳ. Trong MỘT transaction, cấm quét tuần tự, quét bitmap và
      // cấm bước sort: kế hoạch hợp lệ duy nhất là quét một chỉ mục đã sắp xếp sẵn theo ORDER BY. Không so TÊN chỉ mục
      // (bài học từ lỗi CI ở chat-read.int-spec); chỉ khẳng định kiểu quét.
      const plans = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
        const byTarget = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM admin_audit_logs
          WHERE target_type = 'USER' AND target_id = ${randomUUID()}
          ORDER BY created_at DESC, id DESC LIMIT 20`;
        const byActor = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM admin_audit_logs
          WHERE actor_id = ${ACTOR}
          ORDER BY created_at DESC, id DESC LIMIT 20`;
        return { byTarget, byActor };
      });

      const text = (rows: { 'QUERY PLAN': string }[]) =>
        rows.map((r) => r['QUERY PLAN']).join('\n');
      for (const plan of [plans.byTarget, plans.byActor]) {
        expect(text(plan)).toMatch(/Index (Only )?Scan.*admin_audit_logs/);
        expect(text(plan)).not.toMatch(/Seq Scan|Sort/);
      }
    });
  });
});
