import { PrismaClient } from '@prisma/client';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';

// Integration test trên Postgres THẬT cho hai cột mới của `users` (Week11.md 3.1, migration add_user_status_reason). Là lưới
// an toàn cuối nên ghi thẳng bằng Prisma, đi VÒNG qua mọi schema Zod: ràng buộc phải đúng kể cả khi service có lỗi.
// Chạy: `pnpm test:int`.
const TAG = 'it-ustatus-';

describe('users.status_reason / status_changed_at (DB thật)', () => {
  const prisma = new PrismaClient();
  let userId: string;

  const setReason = (statusReason: string | null) =>
    prisma.user.update({ where: { id: userId }, data: { statusReason } });
  const read = () =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        statusReason: true,
        statusChangedAt: true,
        accountStatus: true,
      },
    });

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    userId = (await createUser(prisma, TAG)).id;
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        statusReason: null,
        statusChangedAt: null,
        accountStatus: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('người dùng mới (và mọi người dùng cũ, không backfill) có cả hai cột NULL và vẫn ACTIVE', async () => {
    const other = await createUser(prisma, TAG);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
      select: {
        statusReason: true,
        statusChangedAt: true,
        accountStatus: true,
      },
    });

    expect(row).toEqual({
      statusReason: null,
      statusChangedAt: null,
      accountStatus: 'ACTIVE',
    });
  });

  it('INSERT SQL thô không nhắc tới hai cột ⇒ NULL (không có giá trị mặc định ngầm)', async () => {
    const id = `${TAG}raw-${Date.now()}`;

    await prisma.$executeRaw`
      INSERT INTO users (id, email, name, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, 'raw', now())`;

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { statusReason: true, statusChangedAt: true },
    });
    expect(row).toEqual({ statusReason: null, statusChangedAt: null });
  });

  it('ghi lý do + mốc và đọc lại nguyên vẹn (kể cả nhiều dòng và tiếng Việt có dấu)', async () => {
    const reason = 'Vi phạm điều khoản.\nBán hàng giả.';
    const at = new Date('2026-10-27T10:00:00.000Z');

    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'SUSPENDED',
        statusReason: reason,
        statusChangedAt: at,
      },
    });

    expect(await read()).toEqual({
      accountStatus: 'SUSPENDED',
      statusReason: reason,
      statusChangedAt: at,
    });
  });

  it('mở lại: đặt lại lý do về NULL được (lý do mở lại nằm ở nhật ký, không ở cột này)', async () => {
    await setReason('Lý do cũ');

    await setReason(null);

    expect((await read()).statusReason).toBeNull();
  });

  describe('CHECK users_status_reason_length_in_range (NULL hoặc 1..500 ký tự)', () => {
    it('từ chối chuỗi rỗng (khác NULL)', async () => {
      await expect(setReason('')).rejects.toThrow(
        /users_status_reason_length_in_range|constraint/i,
      );
    });

    it('chấp nhận 1 ký tự và đúng 500 ký tự', async () => {
      await expect(setReason('a')).resolves.toMatchObject({
        statusReason: 'a',
      });
      await expect(setReason('a'.repeat(500))).resolves.toBeDefined();
    });

    it('từ chối 501 ký tự (VARCHAR(500) chặn trước CHECK)', async () => {
      await expect(setReason('a'.repeat(501))).rejects.toThrow();
      expect((await read()).statusReason).toBeNull();
    });

    it('đếm KÝ TỰ chứ không đếm byte: 500 chữ "é" (1000 byte) qua, 501 thì không', async () => {
      await expect(setReason('é'.repeat(500))).resolves.toBeDefined();
      await expect(setReason('é'.repeat(501))).rejects.toThrow();
    });
  });

  it('khoá ngoại / quan hệ cũ không bị ảnh hưởng: xoá người dùng vẫn được (cột mới không phải khoá)', async () => {
    const temp = await createUser(prisma, TAG);
    await prisma.user.update({
      where: { id: temp.id },
      data: {
        accountStatus: 'BANNED',
        statusReason: 'x',
        statusChangedAt: new Date(),
      },
    });

    await prisma.user.delete({ where: { id: temp.id } });

    expect(await prisma.user.count({ where: { id: temp.id } })).toBe(0);
  });
});
