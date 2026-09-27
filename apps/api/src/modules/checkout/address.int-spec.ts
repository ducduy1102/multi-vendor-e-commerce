import { PrismaClient } from '@prisma/client';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { AddressService } from './address.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh 2 ràng buộc viết tay trong
// migration (Week7.md 1.8 mục 4) — "mỗi user tối đa 1 địa chỉ mặc định" (unique index từng phần) và
// "đúng 1 trong userId/shopId" (CHECK) — thật sự có hiệu lực ở DB, độc lập với logic service; và
// AddressService.setDefaultAddress không deadlock/vỡ bất biến khi 2 request chạy đồng thời.
// Chạy: `pnpm test:int`. Dữ liệu mang tiền tố TAG và được dọn sau khi xong (Address cascade theo User).
const TAG = 'it-addr-';

describe('Address (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new AddressService(prisma as unknown as PrismaService);

  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    recipientName: 'Nguyễn Văn A',
    phone: '0912345678',
    line1: '12 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    province: 'Hồ Chí Minh',
    ...overrides,
  });

  const defaultCountOf = (userId: string) =>
    prisma.address.count({ where: { userId, isDefault: true } });

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('CHECK/unique index viết tay (lưới an toàn cuối, độc lập với service)', () => {
    it('từ chối địa chỉ không có userId lẫn shopId', async () => {
      await expect(
        prisma.address.create({
          data: {
            recipientName: 'x',
            phone: '0900000000',
            line1: 'x',
            ward: 'x',
            province: 'x',
          },
        }),
      ).rejects.toThrow(/check constraint|violates/i);
    });

    it('từ chối địa chỉ có CẢ userId lẫn shopId', async () => {
      const user = await createUser(prisma, TAG);
      const shop = await prisma.shop.create({
        data: {
          ownerId: user.id,
          name: `${TAG}s`,
          slug: `${TAG}s-${Date.now()}`,
        },
        select: { id: true },
      });

      await expect(
        prisma.address.create({
          data: {
            userId: user.id,
            shopId: shop.id,
            recipientName: 'x',
            phone: '0900000000',
            line1: 'x',
            ward: 'x',
            province: 'x',
          },
        }),
      ).rejects.toThrow(/check constraint|violates/i);
    });

    it('chỉ userId (không shopId) — hợp lệ', async () => {
      const user = await createUser(prisma, TAG);
      await expect(
        prisma.address.create({
          data: { userId: user.id, ...validPayload() },
        }),
      ).resolves.toBeDefined();
    });

    it('DB từ chối 2 địa chỉ mặc định cùng user — kể cả khi bypass service, ghi thẳng SQL', async () => {
      const user = await createUser(prisma, TAG);
      await prisma.address.create({
        data: { userId: user.id, ...validPayload(), isDefault: true },
      });

      await expect(
        prisma.address.create({
          data: { userId: user.id, ...validPayload(), isDefault: true },
        }),
      ).rejects.toThrow(/unique constraint|duplicate key/i);
    });

    it('2 user khác nhau CÙNG có 1 địa chỉ mặc định — không xung đột (index theo từng user)', async () => {
      const a = await createUser(prisma, TAG);
      const b = await createUser(prisma, TAG);

      await expect(
        Promise.all([
          prisma.address.create({
            data: { userId: a.id, ...validPayload(), isDefault: true },
          }),
          prisma.address.create({
            data: { userId: b.id, ...validPayload(), isDefault: true },
          }),
        ]),
      ).resolves.toBeDefined();
    });
  });

  describe('AddressService — hành vi trên DB thật', () => {
    it('địa chỉ đầu tiên tự mặc định, địa chỉ thứ 2 không', async () => {
      const user = await createUser(prisma, TAG);

      const first = await service.createAddress(user.id, validPayload());
      const second = await service.createAddress(
        user.id,
        validPayload({ line1: 'Line 2' }),
      );

      expect(first.isDefault).toBe(true);
      expect(second.isDefault).toBe(false);
      expect(await defaultCountOf(user.id)).toBe(1);
    });

    it('xoá địa chỉ mặc định — địa chỉ tạo gần nhất còn lại trở thành mặc định', async () => {
      const user = await createUser(prisma, TAG);
      const first = await service.createAddress(user.id, validPayload());
      const second = await service.createAddress(
        user.id,
        validPayload({ line1: 'Line 2' }),
      );

      await service.deleteAddress(user.id, first.id);

      const remaining = await prisma.address.findUnique({
        where: { id: second.id },
      });
      expect(remaining?.isDefault).toBe(true);
      expect(await defaultCountOf(user.id)).toBe(1);
    });

    it('setDefaultAddress: đổi qua lại nhiều lần không bao giờ để lại 2 địa chỉ mặc định', async () => {
      const user = await createUser(prisma, TAG);
      const a = await service.createAddress(user.id, validPayload());
      const b = await service.createAddress(
        user.id,
        validPayload({ line1: 'Line B' }),
      );

      await service.setDefaultAddress(user.id, b.id);
      expect(await defaultCountOf(user.id)).toBe(1);
      await service.setDefaultAddress(user.id, a.id);
      expect(await defaultCountOf(user.id)).toBe(1);
      // idempotent
      await service.setDefaultAddress(user.id, a.id);
      expect(await defaultCountOf(user.id)).toBe(1);

      const finalA = await prisma.address.findUnique({ where: { id: a.id } });
      expect(finalA?.isDefault).toBe(true);
    });

    it('2 request setDefaultAddress đồng thời (2 địa chỉ khác nhau) — không deadlock, kết thúc đúng 1 mặc định', async () => {
      const user = await createUser(prisma, TAG);
      const a = await service.createAddress(user.id, validPayload());
      const b = await service.createAddress(
        user.id,
        validPayload({ line1: 'Line B' }),
      );

      await expect(
        Promise.allSettled([
          service.setDefaultAddress(user.id, a.id),
          service.setDefaultAddress(user.id, b.id),
        ]),
      ).resolves.toEqual([
        { status: 'fulfilled', value: expect.anything() as unknown },
        { status: 'fulfilled', value: expect.anything() as unknown },
      ]);
      expect(await defaultCountOf(user.id)).toBe(1);
    });
  });
});
