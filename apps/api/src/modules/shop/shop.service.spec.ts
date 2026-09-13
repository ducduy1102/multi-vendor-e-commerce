import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ShopService } from './shop.service';

interface ShopCreateArgs {
  data: Record<string, unknown>;
}

describe('ShopService', () => {
  let service: ShopService;
  let prisma: {
    shop: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock<unknown, [ShopCreateArgs]>;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      shop: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn<unknown, [ShopCreateArgs]>(),
        update: jest.fn(),
      },
    };
    service = new ShopService(prisma as unknown as PrismaService);
  });

  function p2002(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
      },
    );
  }

  describe('createShop', () => {
    it('tạo shop thành công, slug tự sinh từ name (bỏ dấu tiếng Việt)', async () => {
      prisma.shop.findFirst.mockResolvedValue(null); // chưa có shop
      prisma.shop.findUnique.mockResolvedValue(null); // slug chưa bị chiếm
      prisma.shop.create.mockResolvedValue({
        id: 'shop-1',
        slug: 'shop-do-abc',
      });

      const result = await service.createShop('user-1', {
        name: 'Shop Đồ ABC',
      });

      expect(result).toEqual({ id: 'shop-1', slug: 'shop-do-abc' });
      expect(prisma.shop.create.mock.calls[0][0].data.slug).toBe('shop-do-abc');
    });

    it('chặn tạo shop thứ 2 nếu user đã có shop (giới hạn 1 shop/user)', async () => {
      prisma.shop.findFirst.mockResolvedValue({ id: 'shop-existing' });

      await expect(
        service.createShop('user-1', { name: 'Shop mới' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shop.create).not.toHaveBeenCalled();
    });

    it('slug tự sinh bị trùng (check trước) thì tự thêm hậu tố -2', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);
      prisma.shop.findUnique
        .mockResolvedValueOnce({ id: 'other-shop' }) // "shop-abc" đã có
        .mockResolvedValueOnce(null); // "shop-abc-2" còn trống
      prisma.shop.create.mockResolvedValue({
        id: 'shop-2',
        slug: 'shop-abc-2',
      });

      const result = await service.createShop('user-1', { name: 'Shop ABC' });

      expect(result).toEqual({ id: 'shop-2', slug: 'shop-abc-2' });
    });

    it('race condition: create() báo P2002 dù đã check trước đó thì tự thử hậu tố kế tiếp', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);
      prisma.shop.findUnique.mockResolvedValue(null); // check trước luôn "chưa có" (race)
      prisma.shop.create
        .mockRejectedValueOnce(p2002()) // request khác vừa tạo "shop-abc" trước
        .mockResolvedValueOnce({ id: 'shop-3', slug: 'shop-abc-2' });

      const result = await service.createShop('user-1', { name: 'Shop ABC' });

      expect(result).toEqual({ id: 'shop-3', slug: 'shop-abc-2' });
      expect(prisma.shop.create).toHaveBeenCalledTimes(2);
    });

    it('slug người dùng tự nhập bị trùng → báo lỗi thẳng, không tự đổi hậu tố', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);
      prisma.shop.findUnique.mockResolvedValue({ id: 'other-shop' });

      await expect(
        service.createShop('user-1', { name: 'Shop ABC', slug: 'shop-abc' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shop.create).not.toHaveBeenCalled();
    });
  });

  describe('getMyShop', () => {
    it('trả về shop nếu user đã có', async () => {
      prisma.shop.findFirst.mockResolvedValue({ id: 'shop-1' });

      await expect(service.getMyShop('user-1')).resolves.toEqual({
        id: 'shop-1',
      });
    });

    it('báo 404 nếu user chưa có shop', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);

      await expect(service.getMyShop('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateShop', () => {
    it('cập nhật thành công nếu đúng chủ sở hữu', async () => {
      prisma.shop.findUnique.mockResolvedValue({
        id: 'shop-1',
        ownerId: 'user-1',
      });
      prisma.shop.update.mockResolvedValue({ id: 'shop-1', name: 'Tên mới' });

      await expect(
        service.updateShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).resolves.toEqual({ id: 'shop-1', name: 'Tên mới' });
    });

    it('báo 403 nếu không phải chủ sở hữu shop', async () => {
      prisma.shop.findUnique.mockResolvedValue({
        id: 'shop-1',
        ownerId: 'user-2',
      });

      await expect(
        service.updateShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.shop.update).not.toHaveBeenCalled();
    });

    it('báo 404 nếu shop không tồn tại', async () => {
      prisma.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.updateShop('user-1', 'shop-missing', { name: 'Tên mới' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
