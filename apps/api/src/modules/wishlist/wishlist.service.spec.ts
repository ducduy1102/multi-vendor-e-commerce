import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { WishlistService } from './wishlist.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { modelName: 'Wishlist' },
  });
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    categoryId: 'cat-1',
    name: 'Áo thun nam',
    slug: 'ao-thun-nam',
    minPrice: '150000',
    maxPrice: '150000',
    status: 'PUBLISHED',
    shop: { status: 'APPROVED' },
    variants: [{ imageUrl: 'https://example.com/a.jpg' }],
    ...overrides,
  };
}

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: {
    wishlist: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      wishlist: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new WishlistService(prisma as unknown as PrismaService);
  });

  describe('addToWishlist', () => {
    it('gọi create với đúng userId/productId', async () => {
      await service.addToWishlist('user-1', 'product-1');

      expect(prisma.wishlist.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', productId: 'product-1' },
      });
    });

    // Week5.md Bước 2.6/2.10 — idempotent: thêm lần 2 (P2002 từ
    // @@unique([userId, productId])) không throw, coi như thành công.
    it('đã wishlist rồi (P2002) — không throw, coi như thành công (idempotent)', async () => {
      prisma.wishlist.create.mockRejectedValue(p2002());

      await expect(
        service.addToWishlist('user-1', 'product-1'),
      ).resolves.toBeUndefined();
    });

    it('lỗi khác P2002 vẫn throw ra ngoài, không nuốt lỗi', async () => {
      const otherError = new Error('DB down');
      prisma.wishlist.create.mockRejectedValue(otherError);

      await expect(service.addToWishlist('user-1', 'product-1')).rejects.toBe(
        otherError,
      );
    });
  });

  describe('removeFromWishlist', () => {
    it('gọi deleteMany với đúng userId/productId', async () => {
      await service.removeFromWishlist('user-1', 'product-1');

      expect(prisma.wishlist.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', productId: 'product-1' },
      });
    });

    // deleteMany() không throw P2025 dù where không khớp row nào (khác
    // delete()) — remove khi chưa từng add vẫn không lỗi (idempotent).
    it('remove khi chưa từng add — không lỗi (idempotent)', async () => {
      prisma.wishlist.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.removeFromWishlist('user-1', 'never-added'),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkIsWishlisted', () => {
    it('trả true nếu đã wishlist', async () => {
      prisma.wishlist.findUnique.mockResolvedValue({ id: 'wishlist-1' });

      const result = await service.checkIsWishlisted('user-1', 'product-1');

      expect(result).toBe(true);
      expect(prisma.wishlist.findUnique).toHaveBeenCalledWith({
        where: {
          userId_productId: { userId: 'user-1', productId: 'product-1' },
        },
        select: { id: true },
      });
    });

    it('trả false nếu chưa wishlist', async () => {
      prisma.wishlist.findUnique.mockResolvedValue(null);

      const result = await service.checkIsWishlisted('user-1', 'product-1');

      expect(result).toBe(false);
    });
  });

  describe('listMyWishlist', () => {
    it('query đúng theo userId của người gọi — không lộ wishlist user khác', async () => {
      await service.listMyWishlist('user-1');

      expect(prisma.wishlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );

      prisma.wishlist.findMany.mockClear();
      await service.listMyWishlist('user-2');

      expect(prisma.wishlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-2' } }),
      );
    });

    it('sort mới nhất trước (createdAt desc)', async () => {
      await service.listMyWishlist('user-1');

      expect(prisma.wishlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('map đúng imageUrl từ variant active đầu tiên, rỗng thì null', async () => {
      prisma.wishlist.findMany.mockResolvedValue([
        { product: productRow({ id: 'p1' }) },
        { product: productRow({ id: 'p2', variants: [] }) },
      ]);

      const result = await service.listMyWishlist('user-1');

      expect(result[0].imageUrl).toBe('https://example.com/a.jpg');
      expect(result[1].imageUrl).toBeNull();
    });

    // Week5.md Bước 1.17 — isAvailable = product PUBLISHED && shop APPROVED.
    it.each([
      ['PUBLISHED', 'APPROVED', true],
      ['PUBLISHED', 'PENDING', false],
      ['DRAFT', 'APPROVED', false],
      ['ARCHIVED', 'APPROVED', false],
    ])(
      'product.status=%s, shop.status=%s -> isAvailable=%s',
      async (status, shopStatus, expected) => {
        prisma.wishlist.findMany.mockResolvedValue([
          { product: productRow({ status, shop: { status: shopStatus } }) },
        ]);

        const result = await service.listMyWishlist('user-1');

        expect(result[0].isAvailable).toBe(expected);
      },
    );

    // rules/backend.md mục 4 — status/shop chỉ dùng nội bộ tính isAvailable,
    // không được lộ nguyên ra response (đúng bug đã gặp ở
    // ProductService.getProduct, phòng lặp lại theo hướng module mới).
    it('KHÔNG lộ field status/shop (nội bộ) ra item trả về', async () => {
      prisma.wishlist.findMany.mockResolvedValue([{ product: productRow() }]);

      const result = await service.listMyWishlist('user-1');

      expect(result[0]).not.toHaveProperty('status');
      expect(result[0]).not.toHaveProperty('shop');
    });
  });
});
