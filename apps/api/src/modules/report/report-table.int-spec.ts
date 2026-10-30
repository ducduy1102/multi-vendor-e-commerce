import { Prisma, PrismaClient, type ReportStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  cleanupByTag,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';

// Integration test trên Postgres THẬT cho bảng `reports` (Week11.md 5.2, migration add_reports_table). Là lưới an toàn cuối nên ghi
// thẳng bằng Prisma, đi VÒNG qua mọi schema Zod: ràng buộc phải đúng kể cả khi service có lỗi. Chạy: `pnpm test:int`.
const TAG = 'it-report-';
const TAG_CLEAN = 'it-rptclean-';

describe('bảng reports (DB thật)', () => {
  const prisma = new PrismaClient();
  let reporterA: string;
  let reporterB: string;
  let admin: string;

  const SHOP_SNAPSHOT = { name: 'Shop A', slug: 'shop-a' };

  const data = (
    overrides: Partial<Prisma.ReportUncheckedCreateInput> = {},
  ): Prisma.ReportUncheckedCreateInput => ({
    reporterId: reporterA,
    targetType: 'SHOP',
    targetId: randomUUID(),
    reasonCode: 'SCAM',
    snapshot: SHOP_SNAPSHOT,
    ...overrides,
  });
  const create = (overrides: Partial<Prisma.ReportUncheckedCreateInput> = {}) =>
    prisma.report.create({ data: data(overrides) });

  // Các cột kết quả xử lý, dùng được cho cả create lẫn update (kiểu hẹp thay vì Partial của cả hàng).
  interface Resolution {
    status: ReportStatus;
    resolvedById: string | null;
    resolvedAt: Date | null;
    resolutionAction: string | null;
    resolutionNote: string | null;
  }
  const closed = (overrides: Partial<Resolution> = {}): Resolution => ({
    status: 'RESOLVED',
    resolvedById: admin,
    resolvedAt: new Date(),
    resolutionAction: 'SUSPEND_SHOP',
    resolutionNote: 'Bán hàng giả',
    ...overrides,
  });
  const dismissed = (overrides: Partial<Resolution> = {}): Resolution =>
    closed({
      status: 'DISMISSED',
      resolutionAction: 'DISMISS',
      resolutionNote: null,
      ...overrides,
    });

  const settle = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return null;
    } catch (error) {
      return error as Error;
    }
  };
  const rejectedWith = async (
    promise: Promise<unknown>,
    constraint: string,
  ) => {
    const error = await settle(promise);
    expect(error).not.toBeNull();
    expect(String((error as Error).message)).toContain(constraint);
  };

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    reporterA = (await createUser(prisma, TAG)).id;
    reporterB = (await createUser(prisma, TAG)).id;
    admin = (await createUser(prisma, TAG)).id;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await cleanupByTag(prisma, TAG_CLEAN);
    await prisma.$disconnect();
  });

  describe('ghi và đọc', () => {
    it('báo cáo mới mặc định OPEN, có id và created_at, mọi cột kết quả NULL', async () => {
      const row = await create({ note: 'Bán hàng giả' });

      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row).toMatchObject({
        status: 'OPEN',
        note: 'Bán hàng giả',
        resolvedById: null,
        resolutionAction: null,
        resolutionNote: null,
        resolvedAt: null,
      });
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('lưu và đọc lại nguyên vẹn ảnh chụp đủ bốn loại (kể cả tiếng Việt có dấu và nhiều dòng)', async () => {
      const snapshots = {
        REVIEW: {
          productName: 'Áo thun cotton',
          productSlug: 'ao-thun-cotton',
          rating: 1,
          comment: 'Hàng giả.\nShop lừa đảo.',
          authorName: 'Nguyễn Văn A',
        },
        CONVERSATION: {
          shopName: 'Shop A',
          buyerName: 'Trần B',
          reporterRole: 'SHOP',
        },
        SHOP: SHOP_SNAPSHOT,
        PRODUCT: { name: 'Áo', slug: 'ao', shopName: 'Shop A' },
      } as const;

      for (const targetType of Object.keys(snapshots) as Array<
        keyof typeof snapshots
      >) {
        const row = await create({
          targetType,
          snapshot: snapshots[targetType],
          reasonCode: 'OTHER',
          note: 'Mô tả\nnhiều dòng',
        });
        const back = await prisma.report.findUniqueOrThrow({
          where: { id: row.id },
        });
        expect([targetType, back.snapshot]).toEqual([
          targetType,
          snapshots[targetType],
        ]);
        expect(back.note).toBe('Mô tả\nnhiều dòng');
      }
    });

    it('enum Postgres chỉ nhận loại và trạng thái của hợp đồng', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO reports (id, reporter_id, target_type, target_id, reason_code, snapshot)
          VALUES (${randomUUID()}, ${reporterA}, 'USER'::"ReportTargetType", ${randomUUID()}, 'SPAM', '{}'::jsonb)`,
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`
          INSERT INTO reports (id, reporter_id, target_type, target_id, reason_code, status, snapshot)
          VALUES (${randomUUID()}, ${reporterA}, 'SHOP', ${randomUUID()}, 'SPAM', 'CLOSED'::"ReportStatus", '{}'::jsonb)`,
      ).rejects.toThrow();
    });
  });

  describe('chỉ mục duy nhất từng phần: mỗi người một báo cáo ĐANG MỞ về một đối tượng', () => {
    it('báo cáo OPEN thứ hai cùng (người báo, loại, đối tượng) bị từ chối bằng P2002 của model Report', async () => {
      const targetId = randomUUID();
      await create({ targetId });

      const error = await settle(
        create({ targetId, reasonCode: 'COUNTERFEIT' }),
      );

      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const known = error as Prisma.PrismaClientKnownRequestError;
      expect(known.code).toBe('P2002');
      expect(known.meta?.modelName).toBe('Report');
    });

    it('người báo khác, đối tượng khác hoặc loại khác (cùng id) đều báo được', async () => {
      const targetId = randomUUID();
      await create({ targetId });

      await expect(
        create({ targetId, reporterId: reporterB }),
      ).resolves.toBeDefined();
      await expect(create({ targetId: randomUUID() })).resolves.toBeDefined();
      await expect(
        create({
          targetId,
          targetType: 'PRODUCT',
          snapshot: { name: 'Áo', slug: 'ao', shopName: 'Shop A' },
          reasonCode: 'COUNTERFEIT',
        }),
      ).resolves.toBeDefined();
    });

    it('báo cáo đã đóng không chặn báo lại: sau khi Admin bỏ qua hoặc xử lý, cùng người báo lại được', async () => {
      const targetId = randomUUID();
      const first = await create({ targetId });
      await prisma.report.update({
        where: { id: first.id },
        data: dismissed(),
      });

      await expect(create({ targetId })).resolves.toMatchObject({
        status: 'OPEN',
      });
    });

    it('nhiều báo cáo ĐÃ ĐÓNG cùng bộ ba vẫn cùng tồn tại (chỉ mục chỉ ràng buộc các hàng OPEN)', async () => {
      const targetId = randomUUID();

      await create({ targetId, ...dismissed() });
      await create({ targetId, ...dismissed() });
      await create({ targetId, ...closed() });

      const count = await prisma.report.count({
        where: { reporterId: reporterA, targetId },
      });
      expect(count).toBe(3);
    });

    it('tám yêu cầu ĐỒNG THỜI cùng bộ ba: đúng một cái thắng, bảy cái còn lại nhận P2002 (chỉ mục là trọng tài, không phải kiểm trước)', async () => {
      const targetId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => create({ targetId })),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((r.reason as Prisma.PrismaClientKnownRequestError).code).toBe(
          'P2002',
        );
      }
    });

    it('mở lại một báo cáo đã đóng về OPEN khi đã có báo cáo OPEN khác cùng bộ ba bị chặn (không có đường nào tạo hai OPEN)', async () => {
      const targetId = randomUUID();
      const old = await create({ targetId, ...dismissed() });
      await create({ targetId });

      const error = await settle(
        prisma.$executeRaw`
          UPDATE reports SET status = 'OPEN', resolved_by_id = NULL, resolved_at = NULL,
            resolution_action = NULL, resolution_note = NULL WHERE id = ${old.id}`,
      );

      // Lỗi UNIQUE của SQL thô là 23505 và không kèm tên chỉ mục (chỉ API model mới cho P2002 có meta).
      expect(error).not.toBeNull();
      expect(String(error?.message)).toMatch(/23505|already exists/);
    });
  });

  describe('đóng báo cáo bằng UPDATE có điều kiện (mẫu của AdminReportsService)', () => {
    it('chỉ một trong hai Admin đóng được; lần hai không khớp hàng nào (count = 0)', async () => {
      const row = await create();
      const close = () =>
        prisma.report.updateMany({
          where: { id: row.id, status: 'OPEN' },
          data: closed({ resolutionAction: 'SUSPEND_SHOP' }),
        });

      const [a, b] = await Promise.all([close(), close()]);

      expect([a.count, b.count].sort()).toEqual([0, 1]);
      const back = await prisma.report.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(back).toMatchObject({
        status: 'RESOLVED',
        resolvedById: admin,
        resolutionAction: 'SUSPEND_SHOP',
      });
      expect(back.resolvedAt).toBeInstanceOf(Date);
    });

    it('đóng hàng loạt các báo cáo OPEN cùng đối tượng trong một câu lệnh, không đụng báo cáo của đối tượng khác hay báo cáo đã đóng', async () => {
      const targetId = randomUUID();
      const other = randomUUID();
      const a = await create({ targetId });
      const b = await create({ targetId, reporterId: reporterB });
      const alreadyClosed = await create({
        targetId,
        reasonCode: 'SPAM',
        ...dismissed(),
      });
      const different = await create({ targetId: other });

      const result = await prisma.report.updateMany({
        where: { targetType: 'SHOP', targetId, status: 'OPEN' },
        data: closed(),
      });

      expect(result.count).toBe(2);
      const states = await prisma.report.findMany({
        where: { id: { in: [a.id, b.id, alreadyClosed.id, different.id] } },
        select: { id: true, status: true },
      });
      const byId = Object.fromEntries(states.map((s) => [s.id, s.status]));
      expect(byId).toEqual({
        [a.id]: 'RESOLVED',
        [b.id]: 'RESOLVED',
        [alreadyClosed.id]: 'DISMISSED',
        [different.id]: 'OPEN',
      });
    });

    it('chỉ đổi status mà quên các cột kết quả bị DB từ chối (không để lại hàng nửa vời)', async () => {
      const row = await create();

      // Có sẵn ghi chú xử lý để chỉ còn đúng một ràng buộc bị vi phạm (Postgres báo ràng buộc đầu tiên theo thứ tự tên).
      await rejectedWith(
        prisma.report.update({
          where: { id: row.id },
          data: { status: 'RESOLVED', resolutionNote: 'đã xử lý' },
        }),
        'reports_status_matches_resolution',
      );
    });
  });

  describe('CHECK độ dài và dạng', () => {
    it.each([
      [
        'reporter_id rỗng',
        { reporterId: '' },
        'reports_reporter_id_length_in_range',
      ],
      [
        'reporter_id 65 ký tự',
        { reporterId: 'a'.repeat(65) },
        'reports_reporter_id_length_in_range',
      ],
      ['target_id rỗng', { targetId: '' }, 'reports_target_id_length_in_range'],
      [
        'target_id 65 ký tự',
        { targetId: 'a'.repeat(65) },
        'reports_target_id_length_in_range',
      ],
    ])('%s bị từ chối', async (_name, overrides, constraint) => {
      await rejectedWith(create(overrides), constraint);
    });

    it('id đúng 64 ký tự thì qua', async () => {
      // Người báo không phải người dùng có tiền tố nên cleanupByTag không dọn được: xoá thẳng, và dùng id ngẫu nhiên để chạy lại
      // không đụng chỉ mục duy nhất từng phần của lần trước.
      const hex64 = () =>
        (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
      const row = await create({ targetId: hex64(), reporterId: hex64() });

      expect(row.targetId).toHaveLength(64);
      expect(row.reporterId).toHaveLength(64);
      await prisma.report.delete({ where: { id: row.id } });
    });

    it.each(['spam', 'SPAM-X', '1SPAM', '', 'A'.repeat(41), 'SPAM ', 'SPÁM'])(
      'reason_code %j sai dạng IN_HOA_GẠCH_DƯỚI bị từ chối',
      async (reasonCode) => {
        await rejectedWith(
          create({ reasonCode }),
          'reports_reason_code_format',
        );
      },
    );

    it('reason_code dạng đúng thì qua, kể cả mã chưa có trong bảng hiện tại và đúng 40 ký tự (thêm mã không cần migration)', async () => {
      for (const reasonCode of [
        'SPAM',
        'FUTURE_REASON_2',
        `A${'B'.repeat(39)}`,
      ]) {
        await expect(create({ reasonCode })).resolves.toMatchObject({
          reasonCode,
        });
      }
    });

    it('resolution_action sai dạng bị từ chối, đúng dạng thì qua', async () => {
      const row = await create();
      await rejectedWith(
        prisma.report.update({
          where: { id: row.id },
          data: closed({ resolutionAction: 'hide_review' }),
        }),
        'reports_resolution_action_format',
      );
      await expect(
        prisma.report.update({
          where: { id: row.id },
          data: closed({ resolutionAction: 'HIDE_REVIEW' }),
        }),
      ).resolves.toMatchObject({ status: 'RESOLVED' });
    });

    it('note: rỗng bị từ chối (khác NULL), 1 và 500 ký tự qua, 501 bị từ chối', async () => {
      await rejectedWith(create({ note: '' }), 'reports_note_length_in_range');
      await expect(create({ note: 'a' })).resolves.toBeDefined();
      await expect(create({ note: 'a'.repeat(500) })).resolves.toBeDefined();
      await rejectedWith(
        create({ note: 'a'.repeat(501) }),
        'reports_note_length_in_range',
      );
    });

    it('resolution_note: rỗng bị từ chối, 500 ký tự qua, 501 bị từ chối', async () => {
      await rejectedWith(
        create({ ...dismissed({ resolutionNote: '' }) }),
        'reports_resolution_note_length_in_range',
      );
      await expect(
        create({ ...closed({ resolutionNote: 'a'.repeat(500) }) }),
      ).resolves.toBeDefined();
      await rejectedWith(
        create({ ...closed({ resolutionNote: 'a'.repeat(501) }) }),
        'reports_resolution_note_length_in_range',
      );
    });

    it('char_length đếm KÝ TỰ chứ không đếm byte: 500 chữ có dấu 3 byte vẫn qua', async () => {
      await expect(create({ note: 'ệ'.repeat(500) })).resolves.toBeDefined();
    });
  });

  describe('CHECK ảnh chụp', () => {
    it.each([
      ['mảng', []],
      ['chuỗi', 'một chuỗi'],
      ['số', 5],
    ])(
      'ảnh chụp là %s (không phải object) bị từ chối',
      async (_name, snapshot) => {
        await rejectedWith(
          create({ snapshot: snapshot as Prisma.InputJsonValue }),
          'reports_snapshot_is_object',
        );
      },
    );

    it('JSON null (khác SQL NULL) cũng bị từ chối', async () => {
      await rejectedWith(
        prisma.report.create({
          data: { ...data(), snapshot: Prisma.JsonNull },
        }),
        'reports_snapshot_is_object',
      );
    });

    it('cận 8192 byte văn bản jsonb: vừa đúng thì qua, thừa một byte thì bị từ chối', async () => {
      // jsonb::text của {"a":"xxx"} là `{"a": "xxx"}` (thêm một dấu cách) ⇒ tổng = độ dài chuỗi + 9.
      const fits = { a: 'x'.repeat(8192 - 9) };
      const tooBig = { a: 'x'.repeat(8192 - 9 + 1) };

      const row = await create({ snapshot: fits });
      const [{ size }] = await prisma.$queryRaw<{ size: number }[]>`
        SELECT octet_length(snapshot::text)::int AS size FROM reports WHERE id = ${row.id}`;
      expect(size).toBe(8192);
      await rejectedWith(
        create({ snapshot: tooBig }),
        'reports_snapshot_size_limit',
      );
    });

    it('biên an toàn gấp đôi đủ cho hình dạng dày đặc nhất: 4096 byte JSON gọn nở ra tối đa ~1,5 lần khi thành văn bản jsonb, vẫn dưới 8192', async () => {
      // Ca xấu nhất của jsonb::text là mảng số nhỏ: mỗi phần tử "0," (2 byte) thành "0, " (3 byte). Đây là hình dạng KHÔNG hợp lệ với
      // ảnh chụp thật (Zod strict từ chối) — chỉ để chứng minh cận DB không bao giờ chặn nhầm thứ mà Zod đã cho qua.
      const n = 2044;
      const dense = { a: Array.from({ length: n }, () => 0) };
      expect(Buffer.byteLength(JSON.stringify(dense))).toBeLessThanOrEqual(
        4096,
      );

      const row = await create({ snapshot: dense });

      const [{ size }] = await prisma.$queryRaw<{ size: number }[]>`
        SELECT octet_length(snapshot::text)::int AS size FROM reports WHERE id = ${row.id}`;
      expect(size).toBeGreaterThan(4096);
      expect(size).toBeLessThanOrEqual(8192);
    });
  });

  describe('CHECK trạng thái ↔ cột kết quả', () => {
    it('OPEN mà đã có người xử lý, thời điểm, hành động hoặc ghi chú xử lý bị từ chối (từng cột một)', async () => {
      const variants: Array<Partial<Resolution>> = [
        { resolvedById: admin },
        { resolvedAt: new Date() },
        { resolutionAction: 'DISMISS' },
        { resolutionNote: 'đã xử lý' },
      ];
      for (const overrides of variants) {
        await rejectedWith(
          create(overrides),
          'reports_status_matches_resolution',
        );
      }
    });

    it('đã đóng mà thiếu người xử lý, thời điểm hoặc hành động bị từ chối (từng cột một)', async () => {
      const variants: Resolution[] = [
        closed({ resolvedById: null }),
        closed({ resolvedAt: null }),
        closed({ resolutionAction: null }),
        dismissed({ resolvedById: null }),
        dismissed({ resolvedAt: null }),
        dismissed({ resolutionAction: null }),
      ];
      for (const overrides of variants) {
        await rejectedWith(
          create(overrides),
          'reports_status_matches_resolution',
        );
      }
    });

    it('RESOLVED đủ cột (có ghi chú) và DISMISSED với hành động DISMISS (ghi chú tuỳ chọn) đều qua', async () => {
      await expect(create(closed())).resolves.toMatchObject({
        status: 'RESOLVED',
      });
      await expect(create(dismissed())).resolves.toMatchObject({
        status: 'DISMISSED',
        resolutionNote: null,
      });
      await expect(
        create(dismissed({ resolutionNote: 'Không vi phạm' })),
      ).resolves.toMatchObject({ resolutionNote: 'Không vi phạm' });
    });

    it('DISMISSED mà hành động không phải DISMISS bị từ chối; RESOLVED mà hành động là DISMISS bị từ chối', async () => {
      await rejectedWith(
        create(dismissed({ resolutionAction: 'HIDE_REVIEW' })),
        'reports_dismissed_iff_dismiss_action',
      );
      await rejectedWith(
        create(closed({ resolutionAction: 'DISMISS' })),
        'reports_dismissed_iff_dismiss_action',
      );
    });

    it('RESOLVED bắt buộc có ghi chú xử lý (lý do đi vào nhật ký và vào cột lý do của hành động)', async () => {
      await rejectedWith(
        create(closed({ resolutionNote: null })),
        'reports_resolved_has_note',
      );
    });

    it('lý do OTHER bắt buộc có mô tả của người báo; lý do khác thì mô tả tuỳ chọn', async () => {
      await rejectedWith(
        create({ reasonCode: 'OTHER' }),
        'reports_other_reason_has_note',
      );
      await rejectedWith(
        create({ reasonCode: 'OTHER', note: null }),
        'reports_other_reason_has_note',
      );
      await expect(
        create({ reasonCode: 'OTHER', note: 'Quảng cáo ngoài sàn' }),
      ).resolves.toBeDefined();
      await expect(create({ reasonCode: 'SCAM' })).resolves.toBeDefined();
    });
  });

  describe('không có khoá ngoại (có chủ đích)', () => {
    it('ghi được báo cáo với người báo, người xử lý và đối tượng không tồn tại trong bảng nào', async () => {
      const row = await create({
        reporterId: randomUUID(),
        targetId: randomUUID(),
        ...closed({ resolvedById: randomUUID() }),
      });

      expect(row.id).toBeDefined();
      await prisma.report.delete({ where: { id: row.id } });
    });

    it('xoá người báo không kéo theo báo cáo (dấu vết còn lại sau khi tài khoản mất)', async () => {
      const temp = await createUser(prisma, TAG);
      const row = await create({ reporterId: temp.id });

      await prisma.user.delete({ where: { id: temp.id } });

      await expect(
        prisma.report.findUnique({ where: { id: row.id } }),
      ).resolves.not.toBeNull();
      // Người báo đã mất nên cleanupByTag không tìm thấy báo cáo này qua người báo: xoá thẳng.
      await prisma.report.delete({ where: { id: row.id } });
    });
  });

  describe('chỉ mục phục vụ các truy vấn của bước 5.3 / 5.4', () => {
    // Bảng chỉ có vài hàng nên planner tự do chọn quét bất kỳ. Trong MỘT transaction, cấm quét tuần tự, quét bitmap và cấm bước sort:
    // kế hoạch hợp lệ duy nhất là quét một chỉ mục đã sắp xếp sẵn theo ORDER BY. Không so TÊN chỉ mục (bài học từ lỗi CI ở
    // chat-read.int-spec); chỉ khẳng định kiểu quét.
    const explain = async (
      run: (
        tx: Prisma.TransactionClient,
      ) => Promise<{ 'QUERY PLAN': string }[]>,
    ) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
        const rows = await run(tx);
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      });

    it('hàng đợi chờ xử lý (cũ nhất trước, có lọc loại) quét chỉ mục, không sắp xếp lại', async () => {
      const plan = await explain(
        (tx) => tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM reports WHERE status = 'OPEN'
          ORDER BY created_at ASC, id ASC LIMIT 20 OFFSET 0`,
      );
      const filtered = await explain(
        (tx) => tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM reports WHERE status = 'OPEN' AND target_type = 'SHOP'
          ORDER BY created_at ASC, id ASC LIMIT 20`,
      );

      for (const text of [plan, filtered]) {
        expect(text).toMatch(/Index (Only )?Scan.*reports/);
        expect(text).not.toMatch(/Seq Scan|Sort/);
      }
    });

    it('tab đã xử lý (xử lý gần nhất trước) quét ngược chỉ mục, không sắp xếp lại', async () => {
      const plan = await explain(
        (tx) => tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM reports WHERE resolved_at IS NOT NULL
          ORDER BY resolved_at DESC, id DESC LIMIT 20`,
      );

      expect(plan).toMatch(/Index (Only )?Scan.*reports/);
      expect(plan).not.toMatch(/Seq Scan|Sort/);
    });

    it('đếm báo cáo trong 24 giờ của một người (trần 10) dùng chỉ mục', async () => {
      const plan = await explain(
        (tx) => tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT count(*) FROM reports
          WHERE reporter_id = ${reporterA} AND created_at > now() - interval '24 hours'`,
      );

      expect(plan).toMatch(/Index (Only )?Scan.*reports/);
      expect(plan).not.toMatch(/Seq Scan/);
    });

    it('báo cáo OPEN cùng đối tượng (đóng hàng loạt, đếm "báo cáo khác") dùng chỉ mục', async () => {
      const plan = await explain(
        (tx) => tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM reports
          WHERE target_type = 'SHOP' AND target_id = ${randomUUID()} AND status = 'OPEN'`,
      );

      expect(plan).toMatch(/Index (Only )?Scan.*reports/);
      expect(plan).not.toMatch(/Seq Scan/);
    });
  });

  describe('dọn dữ liệu test (cleanupByTag)', () => {
    it('xoá báo cáo theo người báo, người xử lý và đối tượng là shop/người dùng có tiền tố; báo cáo của người khác giữ nguyên', async () => {
      const reporter = await createUser(prisma, TAG_CLEAN);
      const resolver = await createUser(prisma, TAG_CLEAN);
      const { shopId } = await createShopWithProduct(prisma, TAG_CLEAN);
      const byReporter = await create({ reporterId: reporter.id });
      const byResolver = await create({
        ...closed({ resolvedById: resolver.id }),
      });
      const aboutShop = await create({ targetId: shopId });
      const unrelated = await create();

      await cleanupByTag(prisma, TAG_CLEAN);

      const remaining = await prisma.report.findMany({
        where: {
          id: {
            in: [byReporter.id, byResolver.id, aboutShop.id, unrelated.id],
          },
        },
        select: { id: true },
      });
      expect(remaining.map((r) => r.id)).toEqual([unrelated.id]);
    });
  });
});
