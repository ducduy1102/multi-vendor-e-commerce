import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma, ShopStatus } from '@prisma/client';
import { SHOP_STATUS_TRANSITIONS } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { AdminService } from './admin.service';

const SHOP_ID = 'shop-1';
const ADMIN_ID = 'admin-1';

describe('AdminService', () => {
  let service: AdminService;
  const prisma = {
    shop: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn<Promise<unknown>, [Prisma.ShopFindManyArgs]>(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminService);
  });

  describe('listShops', () => {
    beforeEach(() => {
      prisma.shop.findMany.mockResolvedValue([{ id: 'a' }]);
      prisma.shop.count.mockResolvedValue(41);
    });

    it('lọc đúng trạng thái, phân trang bằng skip/take, trả total/page/limit', async () => {
      const result = await service.listShops({
        status: 'APPROVED',
        page: 3,
        limit: 20,
      });

      expect(prisma.shop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'APPROVED' },
          skip: 40,
          take: 20,
        }),
      );
      expect(prisma.shop.count).toHaveBeenCalledWith({
        where: { status: 'APPROVED' },
      });
      expect(result).toEqual({
        items: [{ id: 'a' }],
        total: 41,
        page: 3,
        limit: 20,
      });
    });

    it('hàng chờ duyệt (PENDING): cũ nhất trước, id làm tie-break', async () => {
      await service.listShops({ status: 'PENDING', page: 1, limit: 20 });

      expect(prisma.shop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it.each<ShopStatus>(['APPROVED', 'REJECTED', 'SUSPENDED'])(
      'trạng thái %s: lần đổi gần nhất trước, id làm tie-break',
      async (status) => {
        await service.listShops({ status, page: 1, limit: 20 });

        expect(prisma.shop.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          }),
        );
      },
    );

    it('có select chủ shop (name + email) nhưng không select passwordHash/role...', async () => {
      await service.listShops({ status: 'PENDING', page: 1, limit: 20 });

      const [args] = prisma.shop.findMany.mock.calls[0];
      expect(args.select?.owner).toEqual({
        select: { name: true, email: true },
      });
    });
  });

  describe('updateShopStatus', () => {
    const validEdges = Object.entries(SHOP_STATUS_TRANSITIONS).flatMap(
      ([from, targets]) =>
        targets.map((to) => [from, to] as [ShopStatus, ShopStatus]),
    );
    const allStatuses = Object.keys(SHOP_STATUS_TRANSITIONS) as ShopStatus[];
    const invalidEdges = allStatuses.flatMap((from) =>
      allStatuses
        .filter((to) => !SHOP_STATUS_TRANSITIONS[from].includes(to))
        .map((to) => [from, to] as [ShopStatus, ShopStatus]),
    );

    beforeEach(() => {
      prisma.shop.updateMany.mockResolvedValue({ count: 1 });
      prisma.shop.findUniqueOrThrow.mockResolvedValue({ id: SHOP_ID });
    });

    it('shop không tồn tại — 404, không ghi gì', async () => {
      prisma.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shop.updateMany).not.toHaveBeenCalled();
    });

    it.each(validEdges)(
      'cạnh hợp lệ %s → %s: UPDATE có điều kiện status cũ',
      async (from, to) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: to as 'APPROVED' | 'REJECTED' | 'SUSPENDED',
          reason: 'lý do',
        });

        expect(prisma.shop.updateMany).toHaveBeenCalledWith({
          where: { id: SHOP_ID, status: from },
          data: {
            status: to,
            statusReason: to === 'APPROVED' ? null : 'lý do',
          },
        });
      },
    );

    it.each(invalidEdges)(
      'cạnh không hợp lệ %s → %s: 409 SHOP_INVALID_TRANSITION, không ghi gì',
      async (from, to) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await expectAppException(
          service.updateShopStatus(ADMIN_ID, SHOP_ID, {
            // Service nhận cả đích PENDING (ngoài kiểu của DTO) — schema chặn ở validate, service vẫn
            // phải an toàn nếu bị gọi thẳng.
            status: to as 'APPROVED',
            reason: 'lý do',
          }),
          {
            status: 409,
            code: 'SHOP_INVALID_TRANSITION',
            message: `Cannot change shop status from ${from} to ${to}`,
          },
        );
        expect(prisma.shop.updateMany).not.toHaveBeenCalled();
      },
    );

    it('từ chối/khoá: ghi lý do Admin nhập', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'SUSPENDED',
        reason: 'Vi phạm chính sách',
      });

      expect(prisma.shop.updateMany).toHaveBeenCalledWith({
        where: { id: SHOP_ID, status: 'APPROVED' },
        data: { status: 'SUSPENDED', statusReason: 'Vi phạm chính sách' },
      });
    });

    it.each<[ShopStatus]>([['PENDING'], ['SUSPENDED']])(
      'duyệt/mở khoá từ %s: xoá lý do cũ, bỏ qua lý do gửi kèm',
      async (from) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: 'APPROVED',
          reason: 'không được lưu',
        });

        expect(prisma.shop.updateMany).toHaveBeenCalledWith({
          where: { id: SHOP_ID, status: from },
          data: { status: 'APPROVED', statusReason: null },
        });
      },
    );

    it('thua race (UPDATE không lật được dòng nào) — 409, không đọc lại shop', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'PENDING' });
      prisma.shop.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
        { status: 409, code: 'SHOP_INVALID_TRANSITION' },
      );
      expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('trả shop đọc lại sau khi ghi (kèm statusReason, chủ shop)', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'PENDING' });
      const updated = {
        id: SHOP_ID,
        status: 'REJECTED',
        statusReason: 'Thiếu thông tin',
        owner: { name: 'A', email: 'a@example.com' },
      };
      prisma.shop.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'REJECTED',
        reason: 'Thiếu thông tin',
      });

      expect(result).toBe(updated);
      expect(prisma.shop.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SHOP_ID } }),
      );
    });

    it('log ai/shop nào/đổi từ đâu sang đâu, KHÔNG log lý do', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'SUSPENDED',
        reason: 'nội dung nhạy cảm',
      });

      expect(log).toHaveBeenCalledTimes(1);
      const message = String(log.mock.calls[0][0]);
      expect(message).toContain(ADMIN_ID);
      expect(message).toContain(SHOP_ID);
      expect(message).toContain('APPROVED -> SUSPENDED');
      expect(message).not.toContain('nội dung nhạy cảm');
      log.mockRestore();
    });

    it('không log khi đổi thất bại', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await expect(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
      ).rejects.toBeDefined();

      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });
  });
});
