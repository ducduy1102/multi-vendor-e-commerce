import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { ShopStatusService } from './shop-status.service';
import { ShopService } from './shop.service';

interface ShopCreateArgs {
  data: Record<string, unknown>;
}

describe('ShopService', () => {
  let service: ShopService;
  let shopStatusService: { recordCreated: jest.Mock; transition: jest.Mock };
  let prisma: {
    shop: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock<Promise<unknown>, [ShopCreateArgs]>;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      shop: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn<Promise<unknown>, [ShopCreateArgs]>(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      // tx = chính mock prisma: `tx.shop.create` là `prisma.shop.create`, nên các test cũ vẫn kiểm được.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    shopStatusService = {
      recordCreated: jest.fn().mockResolvedValue(undefined),
      transition: jest.fn().mockResolvedValue(undefined),
    };
    service = new ShopService(
      prisma as unknown as PrismaService,
      shopStatusService as unknown as ShopStatusService,
    );
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

    describe('mốc đầu của lịch sử trạng thái (null → PENDING)', () => {
      const createdShop = {
        id: 'shop-1',
        slug: 'shop-abc',
        status: 'PENDING',
        createdAt: new Date('2026-10-04T00:00:00.000Z'),
      };

      it('ghi mốc đầu với actor OWNER = chính người tạo, bằng ĐÚNG tx đã tạo shop (cùng transaction)', async () => {
        prisma.shop.findFirst.mockResolvedValue(null);
        prisma.shop.findUnique.mockResolvedValue(null);
        prisma.shop.create.mockResolvedValue(createdShop);

        await service.createShop('user-1', { name: 'Shop ABC' });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(shopStatusService.recordCreated).toHaveBeenCalledTimes(1);
        expect(shopStatusService.recordCreated).toHaveBeenCalledWith(
          prisma, // tx của $transaction (ở đây là chính mock)
          createdShop,
          { type: 'OWNER', id: 'user-1' },
        );
      });

      it('slug người dùng tự nhập cũng ghi mốc đầu', async () => {
        prisma.shop.findFirst.mockResolvedValue(null);
        prisma.shop.findUnique.mockResolvedValue(null);
        prisma.shop.create.mockResolvedValue(createdShop);

        await service.createShop('user-1', {
          name: 'Shop ABC',
          slug: 'shop-abc',
        });

        expect(shopStatusService.recordCreated).toHaveBeenCalledTimes(1);
      });

      it('thử lại slug sau P2002: mỗi lần thử là 1 transaction riêng, mốc đầu chỉ ghi cho lần thành công', async () => {
        prisma.shop.findFirst.mockResolvedValue(null);
        prisma.shop.findUnique.mockResolvedValue(null);
        prisma.shop.create
          .mockRejectedValueOnce(p2002())
          .mockResolvedValueOnce({ ...createdShop, slug: 'shop-abc-2' });

        await service.createShop('user-1', { name: 'Shop ABC' });

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(shopStatusService.recordCreated).toHaveBeenCalledTimes(1);
      });

      it('ghi mốc đầu lỗi ⇒ createShop lỗi theo (không nuốt lỗi, không trả shop thiếu lịch sử)', async () => {
        prisma.shop.findFirst.mockResolvedValue(null);
        prisma.shop.findUnique.mockResolvedValue(null);
        prisma.shop.create.mockResolvedValue(createdShop);
        shopStatusService.recordCreated.mockRejectedValue(new Error('db down'));

        await expect(
          service.createShop('user-1', { name: 'Shop ABC' }),
        ).rejects.toThrow('db down');
        // Không phải P2002 nên không bị coi là trùng slug và thử lại.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });
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

  describe('updateShop — một câu UPDATE có điều kiện, không đọc-rồi-ghi', () => {
    const SHOP = { id: 'shop-1', name: 'Tên mới' };

    it('cập nhật có điều kiện chủ sở hữu + trạng thái được sửa (REJECTED/APPROVED), chỉ ghi field có giá trị, rồi đọc lại shop', async () => {
      prisma.shop.updateMany.mockResolvedValue({ count: 1 });
      prisma.shop.findUniqueOrThrow.mockResolvedValue(SHOP);

      await expect(
        service.updateShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).resolves.toEqual(SHOP);

      expect(prisma.shop.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'shop-1',
          ownerId: 'user-1',
          status: { in: ['REJECTED', 'APPROVED'] },
        },
        data: { name: 'Tên mới' }, // description/logoUrl/bannerUrl undefined bị bỏ, không ghi đè về null
      });
      // Không có bước "đọc shop rồi kiểm trạng thái" trước khi ghi (kẽ hở giữa 2 tab).
      expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    });

    it('slug/status lọt vào body (gọi thẳng service) cũng KHÔNG bao giờ được ghi', async () => {
      prisma.shop.updateMany.mockResolvedValue({ count: 1 });
      prisma.shop.findUniqueOrThrow.mockResolvedValue(SHOP);

      await service.updateShop('user-1', 'shop-1', {
        name: 'A',
        slug: 'hack',
        status: 'APPROVED',
      } as never);

      const [{ data }] = prisma.shop.updateMany.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).toEqual({ name: 'A' });
    });

    it('body rỗng {} (hợp lệ): updateMany với data rỗng trả count 0 mà không đụng dòng nào nên dùng count() cùng điều kiện — vẫn kiểm trạng thái', async () => {
      prisma.shop.count.mockResolvedValue(1);
      prisma.shop.findUniqueOrThrow.mockResolvedValue(SHOP);

      await expect(service.updateShop('user-1', 'shop-1', {})).resolves.toEqual(
        SHOP,
      );

      expect(prisma.shop.updateMany).not.toHaveBeenCalled();
      expect(prisma.shop.count).toHaveBeenCalledWith({
        where: {
          id: 'shop-1',
          ownerId: 'user-1',
          status: { in: ['REJECTED', 'APPROVED'] },
        },
      });
    });

    it('body rỗng nhưng shop đang PENDING ⇒ vẫn 409 (không vì body rỗng mà bỏ qua luật trạng thái)', async () => {
      prisma.shop.count.mockResolvedValue(0);
      prisma.shop.findUnique.mockResolvedValue({
        ownerId: 'user-1',
        status: 'PENDING',
      });

      await expectAppException(service.updateShop('user-1', 'shop-1', {}), {
        status: 409,
        code: 'SHOP_EDIT_NOT_ALLOWED',
      });
    });

    it.each(['PENDING', 'SUSPENDED'])(
      'shop đang %s ⇒ 409 SHOP_EDIT_NOT_ALLOWED kèm details.status, không ghi gì',
      async (status) => {
        prisma.shop.updateMany.mockResolvedValue({ count: 0 });
        prisma.shop.findUnique.mockResolvedValue({
          ownerId: 'user-1',
          status,
        });

        await expectAppException(
          service.updateShop('user-1', 'shop-1', { name: 'Tên mới' }),
          {
            status: 409,
            code: 'SHOP_EDIT_NOT_ALLOWED',
            message: `Shop details cannot be edited while the shop is ${status}`,
            details: { status },
          },
        );
        expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
      },
    );

    it('báo 403 nếu không phải chủ sở hữu shop — và KHÔNG lộ trạng thái shop (không có details)', async () => {
      prisma.shop.updateMany.mockResolvedValue({ count: 0 });
      prisma.shop.findUnique.mockResolvedValue({
        ownerId: 'user-2',
        status: 'PENDING',
      });

      await expect(
        service.updateShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('báo 404 nếu shop không tồn tại', async () => {
      prisma.shop.updateMany.mockResolvedValue({ count: 0 });
      prisma.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.updateShop('user-1', 'shop-missing', { name: 'Tên mới' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resubmitShop — sửa + nộp lại trong 1 transaction', () => {
    const SHOP = { id: 'shop-1', status: 'PENDING' };
    let log: jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;

    beforeEach(() => {
      prisma.shop.findUniqueOrThrow.mockResolvedValue(SHOP);
      log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      log.mockRestore();
    });

    it('log ai nộp lại shop nào (không log nội dung chỉnh sửa)', async () => {
      await service.resubmitShop('user-1', 'shop-1', {
        name: 'Nội dung nhạy cảm',
      });

      expect(log).toHaveBeenCalledTimes(1);
      const message = String(log.mock.calls[0][0]);
      expect(message).toContain('user-1');
      expect(message).toContain('shop-1');
      expect(message).not.toContain('Nội dung nhạy cảm');
    });

    it('không log khi nộp lại thất bại', async () => {
      shopStatusService.transition.mockRejectedValue(new Error('409'));

      await expect(
        service.resubmitShop('user-1', 'shop-1', {}),
      ).rejects.toBeDefined();

      expect(log).not.toHaveBeenCalled();
    });

    it('chuyển REJECTED → PENDING với actor OWNER = chính user, bằng ĐÚNG tx của transaction; rồi trả shop đọc lại', async () => {
      await expect(
        service.resubmitShop('user-1', 'shop-1', {}),
      ).resolves.toEqual(SHOP);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(shopStatusService.transition).toHaveBeenCalledTimes(1);
      expect(shopStatusService.transition).toHaveBeenCalledWith(
        prisma, // tx của $transaction (ở đây là chính mock)
        'shop-1',
        'REJECTED',
        'PENDING',
        { type: 'OWNER', id: 'user-1' },
      );
    });

    it('body {} hợp lệ: nộp lại không sửa gì — không gọi shop.update', async () => {
      await service.resubmitShop('user-1', 'shop-1', {});

      expect(prisma.shop.update).not.toHaveBeenCalled();
    });

    it('có sửa: chuyển trạng thái TRƯỚC rồi mới ghi field (thứ tự lấy khoá hàng), chỉ field có giá trị', async () => {
      const order: string[] = [];
      shopStatusService.transition.mockImplementation(() => {
        order.push('transition');
        return Promise.resolve();
      });
      prisma.shop.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({});
      });

      await service.resubmitShop('user-1', 'shop-1', {
        name: 'Tên đã sửa',
        description: 'Mô tả mới',
      });

      expect(order).toEqual(['transition', 'update']);
      expect(prisma.shop.update).toHaveBeenCalledWith({
        where: { id: 'shop-1' },
        data: { name: 'Tên đã sửa', description: 'Mô tả mới' },
      });
    });

    it('status/slug lọt vào body (gọi thẳng service) cũng không bao giờ được ghi', async () => {
      await service.resubmitShop('user-1', 'shop-1', {
        name: 'A',
        status: 'APPROVED',
        slug: 'hack',
      } as never);

      expect(prisma.shop.update).toHaveBeenCalledWith({
        where: { id: 'shop-1' },
        data: { name: 'A' },
      });
    });

    it('shop không còn REJECTED (transition ném 409) ⇒ lỗi lan ra, KHÔNG field nào bị sửa, không đọc lại shop', async () => {
      shopStatusService.transition.mockRejectedValue(
        new Error('SHOP_INVALID_TRANSITION'),
      );

      await expect(
        service.resubmitShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).rejects.toThrow('SHOP_INVALID_TRANSITION');

      expect(prisma.shop.update).not.toHaveBeenCalled();
      expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('sửa field lỗi sau khi đã chuyển trạng thái ⇒ lỗi lan ra để $transaction rollback cả chuyển trạng thái', async () => {
      prisma.shop.update.mockRejectedValue(new Error('db down'));

      await expect(
        service.resubmitShop('user-1', 'shop-1', { name: 'Tên mới' }),
      ).rejects.toThrow('db down');
      // Không nuốt lỗi: không đọc lại/không trả shop như thể đã thành công.
      expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
