import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { cleanupByTag, createUser } from '../testing/db-fixtures';

// Integration test trên Postgres THẬT cho các BẤT BIẾN của bảng notifications (Week10.md 7.1). Đây là lưới an toàn
// cuối, nên test đi VÒNG qua service (ghi thẳng bằng Prisma): ràng buộc phải đúng kể cả khi service có lỗi.
// Chạy: `pnpm test:int`.
const TAG = 'it-notif-schema-';

describe('Schema notifications (DB thật)', () => {
  const prisma = new PrismaClient();
  let userId: string;
  let otherUserId: string;

  const create = (
    data: Prisma.InputJsonValue | typeof Prisma.JsonNull,
    options: { userId?: string; type?: string } = {},
  ) =>
    prisma.notification.create({
      data: {
        userId: options.userId ?? userId,
        type: options.type ?? 'ORDER_NEW',
        data,
      },
    });

  // Độ dài văn bản của jsonb (cái mà CHECK đo): {"k": "<n ký tự>"} có thêm 9 byte cố định (7 đầu + 2 cuối).
  const labelOfBytes = (total: number) => 'a'.repeat(total - 9);

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    userId = (await createUser(prisma, TAG)).id;
    otherUserId = (await createUser(prisma, TAG)).id;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('giá trị mặc định', () => {
    it('chưa đọc (read_at NULL), có id UUID và mốc tạo; data được lưu nguyên cấu trúc', async () => {
      const orderId = randomUUID();

      const row = await create({ orderId, shopName: 'Cửa hàng Ánh Dương' });

      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.readAt).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.data).toEqual({ orderId, shopName: 'Cửa hàng Ánh Dương' });
    });

    it('nhãn chứa <img onerror> được lưu NGUYÊN VĂN như chữ (không HTML hoá ở DB)', async () => {
      const label = '<img src=x onerror=alert(1)><script>alert(2)</script>';

      const row = await create({ productName: label });

      expect(row.data).toEqual({ productName: label });
    });
  });

  describe('CHECK độ dài type (1..64 ký tự)', () => {
    it.each([
      ['rỗng', ''],
      ['65 ký tự', 'T'.repeat(65)],
    ])('từ chối type %s', async (_name, type) => {
      await expect(create({}, { type })).rejects.toThrow(
        /notifications_type_length_in_range|constraint/i,
      );
    });

    it.each([
      ['1 ký tự', 'T'],
      ['đúng 64 ký tự', 'T'.repeat(64)],
    ])('chấp nhận type %s', async (_name, type) => {
      const row = await create({}, { type });

      expect(row.type).toBe(type);
    });
  });

  describe('CHECK data phải là JSON object', () => {
    it.each([
      ['mảng', []],
      ['chuỗi', 'ORDER_NEW'],
      ['số', 42],
      ['boolean', true],
    ])('từ chối data là %s', async (_name, value) => {
      await expect(create(value as Prisma.InputJsonValue)).rejects.toThrow(
        /notifications_data_is_object|constraint/i,
      );
    });

    it('từ chối JSON null (khác với NULL của SQL — cột NOT NULL vẫn cho JSON null đi qua nếu không có CHECK)', async () => {
      await expect(create(Prisma.JsonNull)).rejects.toThrow(
        /notifications_data_is_object|constraint/i,
      );
    });

    it('chấp nhận object rỗng và object lồng nhau', async () => {
      await expect(create({})).resolves.toMatchObject({ data: {} });
      await expect(
        create({ a: { b: [1, 2, { c: 'd' }] } }),
      ).resolves.toMatchObject({ data: { a: { b: [1, 2, { c: 'd' }] } } });
    });
  });

  describe('CHECK kích thước data (≤ 2048 byte văn bản jsonb)', () => {
    it('đúng 2048 byte thì qua, 2049 byte thì bị từ chối (đo bằng octet_length trên chính hàng đã ghi)', async () => {
      const ok = await create({ k: labelOfBytes(2048) });
      const [measured] = await prisma.$queryRaw<{ bytes: number }[]>`
        SELECT octet_length(data::text)::int AS bytes FROM notifications WHERE id = ${ok.id}`;

      expect(measured.bytes).toBe(2048);
      await expect(create({ k: labelOfBytes(2049) })).rejects.toThrow(
        /notifications_data_size_limit|constraint/i,
      );
    });

    it('đếm BYTE chứ không đếm ký tự: 1100 chữ "é" (1100 ký tự, 2200 byte) bị từ chối', async () => {
      const label = 'é'.repeat(1100);
      expect(label).toHaveLength(1100);

      await expect(create({ k: label })).rejects.toThrow(
        /notifications_data_size_limit|constraint/i,
      );
    });

    it('JSON gọn 1024 byte (cận của Zod) luôn qua CHECK dù jsonb::text dài hơn do thêm dấu cách', async () => {
      // 40 khoá để jsonb::text thêm nhiều dấu cách nhất có thể mà JSON gọn vẫn đúng 1024 byte.
      const data: Record<string, string> = {};
      for (let i = 0; i < 40; i++) data[`k${String(i).padStart(2, '0')}`] = '';
      const fixed = JSON.stringify(data).length;
      data.k00 = 'a'.repeat(1024 - fixed);
      expect(JSON.stringify(data)).toHaveLength(1024);

      const row = await create(data);

      expect(row.data).toEqual(data);
    });
  });

  describe('quan hệ với người dùng', () => {
    it('không ghi được thông báo cho người dùng không tồn tại (khoá ngoại)', async () => {
      await expect(create({}, { userId: randomUUID() })).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('xoá người dùng kéo theo thông báo của họ (cascade), người khác không bị ảnh hưởng', async () => {
      const temp = await createUser(prisma, TAG);
      await create({ n: 1 }, { userId: temp.id });
      await create({ n: 2 }, { userId: temp.id });
      const kept = await create({ n: 3 }, { userId: otherUserId });

      await prisma.user.delete({ where: { id: temp.id } });

      expect(
        await prisma.notification.count({ where: { userId: temp.id } }),
      ).toBe(0);
      expect(await prisma.notification.count({ where: { id: kept.id } })).toBe(
        1,
      );
    });
  });

  describe('chỉ mục theo thiết kế', () => {
    it('có đúng hai chỉ mục thiết kế (cộng khoá chính), không chỉ mục đơn dư thừa', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`;

      expect(rows.map((r) => r.indexname).sort()).toEqual([
        'notifications_pkey',
        'notifications_user_id_created_at_id_idx',
        'notifications_user_id_read_at_created_at_id_idx',
      ]);
    });

    it('danh sách, danh sách chưa đọc và đếm chưa đọc đều được phục vụ bằng quét chỉ mục, KHÔNG sắp xếp lại', async () => {
      // Bảng chỉ có vài hàng nên planner tự do chọn quét bất kỳ. Trong MỘT transaction, cấm quét tuần tự, quét bitmap
      // và cấm bước sort: kế hoạch hợp lệ duy nhất là quét một chỉ mục đã sắp xếp sẵn theo ORDER BY. Không so TÊN chỉ
      // mục (planner trên DB mới có thể chọn chỉ mục còn lại cũng hợp lệ — bài học từ lỗi CI ở chat-read.int-spec).
      const plans = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
        const all = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM notifications
          WHERE user_id = ${userId}
          ORDER BY created_at DESC, id DESC LIMIT 20`;
        const unread = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM notifications
          WHERE user_id = ${userId} AND read_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 20`;
        const count = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT count(*) FROM notifications
          WHERE user_id = ${userId} AND read_at IS NULL`;
        return { all, unread, count };
      });

      const text = (rows: { 'QUERY PLAN': string }[]) =>
        rows.map((r) => r['QUERY PLAN']).join('\n');
      for (const plan of [plans.all, plans.unread, plans.count]) {
        expect(text(plan)).toMatch(/Index (Only )?Scan.*notifications/);
        expect(text(plan)).not.toMatch(/Seq Scan|Sort/);
      }
    });
  });
});
