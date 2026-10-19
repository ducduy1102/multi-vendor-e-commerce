import type { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaChatDirectory } from './prisma-chat-directory';

describe('PrismaChatDirectory', () => {
  const findUnique = jest.fn();
  const directory = new PrismaChatDirectory({
    shop: { findUnique },
  } as unknown as PrismaService);

  beforeEach(() => findUnique.mockReset());

  it('tra shop theo id và chỉ select đúng 5 cột chat cần (không kéo cả hàng shop)', async () => {
    findUnique.mockResolvedValue({ id: 's1' });

    await directory.getShopForChat('s1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: {
        id: true,
        ownerId: true,
        status: true,
        name: true,
        logoUrl: true,
      },
    });
  });

  it('shop không tồn tại ⇒ null', async () => {
    findUnique.mockResolvedValue(null);

    await expect(directory.getShopForChat('nope')).resolves.toBeNull();
  });

  it('lỗi DB được ném tiếp', async () => {
    findUnique.mockRejectedValue(new Error('db down'));

    await expect(directory.getShopForChat('s1')).rejects.toThrow('db down');
  });
});
