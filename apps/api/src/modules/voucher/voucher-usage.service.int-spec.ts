import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  cleanupByTag,
  createCheckoutGroup,
  createUser,
} from '../../shared/testing/db-fixtures';
import type { TxClient } from '../../shared/prisma/tx-client';
import { VoucherUsageService } from './voucher-usage.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh 2 checkout song song
// không cùng vượt usageLimit/perUserLimit — thứ mà unit test với tx giả không kiểm được.
// Chạy: `pnpm test:int`. Dữ liệu mang tiền tố TAG và được dọn sau khi xong.
const TAG = 'it-vou-';
const LIMIT_REACHED = 'Voucher usage limit has been reached';
const PER_USER_REACHED = 'You have reached the usage limit for this voucher';

describe('VoucherUsageService (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new VoucherUsageService();
  let codeSeq = 0;

  const createVoucher = (overrides: {
    usageLimit?: number | null;
    perUserLimit?: number | null;
  }) =>
    prisma.voucher.create({
      data: {
        code: `${TAG.toUpperCase()}${Date.now().toString(36).toUpperCase()}${codeSeq++}`,
        type: 'FIXED',
        value: 50000,
        usageLimit: overrides.usageLimit ?? null,
        perUserLimit: overrides.perUserLimit ?? null,
      },
      select: { id: true, perUserLimit: true },
    });

  // Mỗi lần thử = 1 nhóm checkout riêng, giống thực tế (unique [voucherId, checkoutGroupId]).
  const consumeOnce = async (
    voucher: { id: string; perUserLimit: number | null },
    userId: string,
  ) => {
    const group = await createCheckoutGroup(prisma, userId);
    await prisma.$transaction((tx) =>
      service.consume(tx as TxClient, {
        voucherId: voucher.id,
        userId,
        checkoutGroupId: group.id,
        discountAmount: 50000,
        perUserLimit: voucher.perUserLimit,
      }),
    );
    return group.id;
  };
  const usedCountOf = async (voucherId: string) =>
    (
      await prisma.voucher.findUniqueOrThrow({
        where: { id: voucherId },
        select: { usedCount: true },
      })
    ).usedCount;
  const activeUsageCount = (voucherId: string) =>
    prisma.voucherUsage.count({ where: { voucherId, releasedAt: null } });

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('consume: tăng usedCount và ghi 1 VoucherUsage', async () => {
    const voucher = await createVoucher({ usageLimit: 5 });
    const user = await createUser(prisma, TAG);

    await consumeOnce(voucher, user.id);

    expect(await usedCountOf(voucher.id)).toBe(1);
    expect(await activeUsageCount(voucher.id)).toBe(1);
  });

  it('hết lượt toàn hệ thống — từ chối đúng chữ, usedCount không vượt limit', async () => {
    const voucher = await createVoucher({ usageLimit: 1 });
    const u1 = await createUser(prisma, TAG);
    const u2 = await createUser(prisma, TAG);
    await consumeOnce(voucher, u1.id);

    await expect(consumeOnce(voucher, u2.id)).rejects.toThrow(
      new BadRequestException(LIMIT_REACHED),
    );
    expect(await usedCountOf(voucher.id)).toBe(1);
  });

  it('vượt perUserLimit — từ chối và ROLLBACK lượt usedCount vừa tăng', async () => {
    const voucher = await createVoucher({ usageLimit: 10, perUserLimit: 1 });
    const user = await createUser(prisma, TAG);
    await consumeOnce(voucher, user.id);

    await expect(consumeOnce(voucher, user.id)).rejects.toThrow(
      new BadRequestException(PER_USER_REACHED),
    );
    expect(await usedCountOf(voucher.id)).toBe(1);
    expect(await activeUsageCount(voucher.id)).toBe(1);
  });

  it('release: nhả lượt (releasedAt) và giảm usedCount; user dùng lại được dưới perUserLimit', async () => {
    const voucher = await createVoucher({ usageLimit: 10, perUserLimit: 1 });
    const user = await createUser(prisma, TAG);
    const groupId = await consumeOnce(voucher, user.id);

    const released = await prisma.$transaction((tx) =>
      service.release(tx as TxClient, groupId),
    );

    expect(released).toBe(1);
    expect(await usedCountOf(voucher.id)).toBe(0);
    expect(await activeUsageCount(voucher.id)).toBe(0);
    // Dòng lịch sử vẫn còn (xoá mềm), chỉ đánh dấu đã nhả.
    expect(
      await prisma.voucherUsage.count({
        where: { checkoutGroupId: groupId, releasedAt: { not: null } },
      }),
    ).toBe(1);
    await expect(consumeOnce(voucher, user.id)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('release gọi lặp — không nhả/trừ usedCount lần 2', async () => {
    const voucher = await createVoucher({ usageLimit: 10 });
    const user = await createUser(prisma, TAG);
    const other = await createUser(prisma, TAG);
    const groupId = await consumeOnce(voucher, user.id);
    await consumeOnce(voucher, other.id); // usedCount = 2, để nếu trừ lần 2 sẽ lộ ra

    const releaseOnce = () =>
      prisma.$transaction((tx) => service.release(tx as TxClient, groupId));
    expect(await releaseOnce()).toBe(1);
    expect(await releaseOnce()).toBe(0);

    expect(await usedCountOf(voucher.id)).toBe(1);
  });

  it('release song song cùng 1 nhóm — đúng 1 bên nhả, usedCount chỉ giảm 1', async () => {
    const voucher = await createVoucher({ usageLimit: 10 });
    const user = await createUser(prisma, TAG);
    const other = await createUser(prisma, TAG);
    const groupId = await consumeOnce(voucher, user.id);
    await consumeOnce(voucher, other.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => service.release(tx as TxClient, groupId)),
      ),
    );

    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(await usedCountOf(voucher.id)).toBe(1);
  });

  describe('đồng thời', () => {
    it('8 checkout song song, mỗi người 1 user, usageLimit = 3: đúng 3 thành công', async () => {
      const voucher = await createVoucher({ usageLimit: 3 });
      const users = await Promise.all(
        Array.from({ length: 8 }, () => createUser(prisma, TAG)),
      );

      const results = await Promise.allSettled(
        users.map((u) => consumeOnce(voucher, u.id)),
      );

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(
        rejected.every(
          (r) =>
            r.reason instanceof BadRequestException &&
            r.reason.message === LIMIT_REACHED,
        ),
      ).toBe(true);
      expect(await usedCountOf(voucher.id)).toBe(3);
      expect(await activeUsageCount(voucher.id)).toBe(3);
    });

    it('6 checkout song song của CÙNG 1 user, perUserLimit = 1: đúng 1 thành công (không đọc-rồi-ghi)', async () => {
      const voucher = await createVoucher({ usageLimit: 20, perUserLimit: 1 });
      const user = await createUser(prisma, TAG);

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => consumeOnce(voucher, user.id)),
      );

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        rejected.every(
          (r) =>
            r.reason instanceof BadRequestException &&
            r.reason.message === PER_USER_REACHED,
        ),
      ).toBe(true);
      expect(await usedCountOf(voucher.id)).toBe(1);
      expect(await activeUsageCount(voucher.id)).toBe(1);
    });
  });

  describe('bất biến & CHECK constraint ở DB', () => {
    it('usedCount luôn khớp số VoucherUsage chưa nhả sau chuỗi consume/release', async () => {
      const voucher = await createVoucher({ usageLimit: 10 });
      const users = await Promise.all(
        Array.from({ length: 4 }, () => createUser(prisma, TAG)),
      );
      const groups = await Promise.all(
        users.map((u) => consumeOnce(voucher, u.id)),
      );
      await prisma.$transaction((tx) =>
        service.release(tx as TxClient, groups[0]),
      );
      await prisma.$transaction((tx) =>
        service.release(tx as TxClient, groups[2]),
      );

      expect(await usedCountOf(voucher.id)).toBe(2);
      expect(await activeUsageCount(voucher.id)).toBe(2);
    });

    it.each([
      ['used_count < 0', 'used_count = -1'],
      ['used_count > usage_limit', 'used_count = usage_limit + 1'],
    ])('DB từ chối ghi %s', async (_label, setClause) => {
      const voucher = await createVoucher({ usageLimit: 2 });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE vouchers SET ${setClause} WHERE id = '${voucher.id}'`,
        ),
      ).rejects.toThrow(/check constraint|violates/i);
    });
  });
});
