import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { cleanupAdminNotifications } from './admin-notification-cleanup';
import { cleanupByTag, createUser } from './db-fixtures';

// Integration test trên Postgres THẬT cho hàm dọn thông báo Admin (Week11.md 2.1): bộ unit test chỉ khoá HÌNH của câu
// `where`; ở đây chứng minh nó xoá ĐÚNG hàng — đúng người (role ADMIN), đúng mốc (gte), không đụng người dùng thường.
// Chạy: `pnpm test:int`.
const TAG = 'it-admin-cleanup-';

describe('cleanupAdminNotifications (DB thật)', () => {
  const prisma = new PrismaClient();
  // Mốc ở TƯƠNG LAI (ngày mai) có chủ đích: hàm xoá mọi thông báo Admin từ mốc trở đi, kể cả của Admin THẬT trong DB
  // dev. Đặt mốc xa hơn mọi thông báo thật đang có thì test chỉ chạm đúng các hàng nó tự dựng.
  const since = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const at = (offsetMs: number) => new Date(since.getTime() + offsetMs);

  let adminId: string;
  let userId: string;

  const notify = (recipientId: string, createdAt: Date) =>
    prisma.notification.create({
      data: { userId: recipientId, type: 'TEST_TYPE', data: {}, createdAt },
      select: { id: true },
    });
  const survivors = async (ids: string[]) =>
    (
      await prisma.notification.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      })
    )
      .map((row) => row.id)
      .sort();

  beforeAll(async () => {
    adminId = (
      await prisma.user.create({
        data: {
          email: `${TAG}admin-${randomUUID()}@test.local`,
          name: `${TAG}admin`,
          role: 'ADMIN',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    userId = (await createUser(prisma, TAG)).id;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('xoá thông báo của Admin từ mốc trở đi (kể cả đúng mốc), giữ thông báo cũ hơn và của người dùng thường', async () => {
    const adminBefore = await notify(adminId, at(-60 * 60 * 1000));
    const adminJustBefore = await notify(adminId, at(-1));
    const adminAtMark = await notify(adminId, at(0));
    const adminAfter = await notify(adminId, at(1000));
    const userBefore = await notify(userId, at(-60 * 60 * 1000));
    const userAfter = await notify(userId, at(60 * 60 * 1000));
    const all = [
      adminBefore,
      adminJustBefore,
      adminAtMark,
      adminAfter,
      userBefore,
      userAfter,
    ].map((row) => row.id);

    const count = await cleanupAdminNotifications(prisma, since);

    expect(count).toBe(2);
    expect(await survivors(all)).toEqual(
      [adminBefore, adminJustBefore, userBefore, userAfter]
        .map((row) => row.id)
        .sort(),
    );
  });

  it('gọi lại không còn gì để xoá', async () => {
    await expect(cleanupAdminNotifications(prisma, since)).resolves.toBe(0);
  });
});
