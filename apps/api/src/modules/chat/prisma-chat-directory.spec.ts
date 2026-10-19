import type { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaChatDirectory } from './prisma-chat-directory';

const SHOP_SELECT = {
  id: true,
  ownerId: true,
  status: true,
  name: true,
  logoUrl: true,
};

describe('PrismaChatDirectory', () => {
  const shopFindUnique = jest.fn();
  const shopFindMany = jest.fn();
  const userFindMany = jest.fn();
  const directory = new PrismaChatDirectory({
    shop: { findUnique: shopFindUnique, findMany: shopFindMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaService);

  beforeEach(() => {
    shopFindUnique.mockReset();
    shopFindMany.mockReset();
    userFindMany.mockReset();
  });

  describe('getShopForChat', () => {
    it('tra shop theo id và chỉ select đúng 5 cột chat cần (không kéo cả hàng shop)', async () => {
      shopFindUnique.mockResolvedValue({ id: 's1' });

      await directory.getShopForChat('s1');

      expect(shopFindUnique).toHaveBeenCalledWith({
        where: { id: 's1' },
        select: SHOP_SELECT,
      });
    });

    it('shop không tồn tại ⇒ null', async () => {
      shopFindUnique.mockResolvedValue(null);

      await expect(directory.getShopForChat('nope')).resolves.toBeNull();
    });

    it('lỗi DB được ném tiếp', async () => {
      shopFindUnique.mockRejectedValue(new Error('db down'));

      await expect(directory.getShopForChat('s1')).rejects.toThrow('db down');
    });
  });

  describe('getShopsForChat', () => {
    it('tra nhiều shop bằng MỘT truy vấn, khử trùng id, cùng 5 cột như getShopForChat', async () => {
      shopFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

      const result = await directory.getShopsForChat(['s1', 's2', 's1']);

      expect(result).toEqual([{ id: 's1' }, { id: 's2' }]);
      expect(shopFindMany).toHaveBeenCalledTimes(1);
      expect(shopFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        select: SHOP_SELECT,
      });
    });

    it('danh sách rỗng ⇒ [] và KHÔNG truy vấn DB', async () => {
      await expect(directory.getShopsForChat([])).resolves.toEqual([]);

      expect(shopFindMany).not.toHaveBeenCalled();
    });

    it('lỗi DB được ném tiếp', async () => {
      shopFindMany.mockRejectedValue(new Error('db down'));

      await expect(directory.getShopsForChat(['s1'])).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('getUserDisplay', () => {
    it('CHỈ select id và name — không email, SĐT, mật khẩu hay bất kỳ cột nào khác', async () => {
      userFindMany.mockResolvedValue([{ id: 'u1', name: 'An' }]);

      const result = await directory.getUserDisplay(['u1']);

      expect(result).toEqual([{ id: 'u1', name: 'An' }]);
      expect(userFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['u1'] } },
        select: { id: true, name: true },
      });
    });

    it('tra nhiều người bằng MỘT truy vấn và khử trùng id', async () => {
      userFindMany.mockResolvedValue([]);

      await directory.getUserDisplay(['u1', 'u2', 'u1', 'u2']);

      expect(userFindMany).toHaveBeenCalledTimes(1);
      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['u1', 'u2'] } } }),
      );
    });

    it('danh sách rỗng ⇒ [] và KHÔNG truy vấn DB', async () => {
      await expect(directory.getUserDisplay([])).resolves.toEqual([]);

      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('lỗi DB được ném tiếp', async () => {
      userFindMany.mockRejectedValue(new Error('db down'));

      await expect(directory.getUserDisplay(['u1'])).rejects.toThrow('db down');
    });
  });
});
