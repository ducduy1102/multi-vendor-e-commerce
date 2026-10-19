import { Logger } from '@nestjs/common';
import type { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import { parseManagedImageUrl } from '../../shared/cloudinary/cloudinary-url';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { ProductImageCleanupService } from './product-image-cleanup.service';

const CLOUD = 'demo-cloud';
const url = (id: string, cloud = CLOUD) =>
  `https://res.cloudinary.com/${cloud}/image/upload/v1/multi-vendor-ecommerce/${id}.jpg`;
const pid = (id: string) => `multi-vendor-ecommerce/${id}`;

// Unit test với Prisma/Cloudinary giả: khoá lại LUẬT "chỉ xoá khi không còn nơi nào tham chiếu" và "mọi lỗi đều
// không xoá gì, không ném". Hành vi với Postgres thật (kể cả snapshot đơn hàng) nằm ở
// product-image-cleanup.int-spec.ts.
describe('ProductImageCleanupService', () => {
  let service: ProductImageCleanupService;
  let prisma: {
    productImage: { findMany: jest.Mock };
    orderItem: { findMany: jest.Mock };
    shop: { findMany: jest.Mock };
  };
  let cloudinary: { getManagedPublicId: jest.Mock; deleteImages: jest.Mock };
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      productImage: { findMany: jest.fn().mockResolvedValue([]) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      shop: { findMany: jest.fn().mockResolvedValue([]) },
    };
    cloudinary = {
      // Dùng hàm phân tích thật để test bám đúng luật "ảnh của mình".
      getManagedPublicId: jest.fn((value: string) =>
        parseManagedImageUrl(value, CLOUD),
      ),
      deleteImages: jest.fn().mockResolvedValue({ failed: [] }),
    };
    service = new ProductImageCleanupService(
      prisma as unknown as PrismaService,
      cloudinary as unknown as CloudinaryService,
    );
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('ảnh không còn nơi nào tham chiếu ⇒ xoá', async () => {
    await service.deleteUnreferenced([url('a')]);

    expect(cloudinary.deleteImages).toHaveBeenCalledWith([pid('a')]);
  });

  describe('còn được tham chiếu ⇒ GIỮ LẠI, không xoá', () => {
    it('bởi ảnh của biến thể/sản phẩm khác (product_images)', async () => {
      prisma.productImage.findMany.mockResolvedValue([{ url: url('a') }]);

      await service.deleteUnreferenced([url('a')]);

      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });

    it('bởi ẢNH CHỤP LẠI trong đơn hàng (order_items.image_url) — xoá là vỡ lịch sử đơn', async () => {
      prisma.orderItem.findMany.mockResolvedValue([{ imageUrl: url('a') }]);

      await service.deleteUnreferenced([url('a')]);

      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });

    it('bởi logo shop', async () => {
      prisma.shop.findMany.mockResolvedValue([
        { logoUrl: url('a'), bannerUrl: null },
      ]);

      await service.deleteUnreferenced([url('a')]);

      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });

    it('bởi banner shop', async () => {
      prisma.shop.findMany.mockResolvedValue([
        { logoUrl: null, bannerUrl: url('a') },
      ]);

      await service.deleteUnreferenced([url('a')]);

      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });

    it('bởi một URL KHÁC của cùng tệp (đã biến đổi / đổi đuôi) — kiểm theo "chứa public_id"', async () => {
      prisma.shop.findMany.mockResolvedValue([
        {
          logoUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w_200/v9/multi-vendor-ecommerce/a.webp`,
          bannerUrl: null,
        },
      ]);

      await service.deleteUnreferenced([url('a')]);

      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });
  });

  it('một lô: chỉ xoá những ảnh KHÔNG còn tham chiếu, giữ những ảnh còn', async () => {
    prisma.productImage.findMany.mockResolvedValue([{ url: url('keep1') }]);
    prisma.orderItem.findMany.mockResolvedValue([{ imageUrl: url('keep2') }]);

    await service.deleteUnreferenced([
      url('keep1'),
      url('gone1'),
      url('keep2'),
      url('gone2'),
    ]);

    expect(cloudinary.deleteImages).toHaveBeenCalledTimes(1);
    expect(
      [...(cloudinary.deleteImages.mock.calls as string[][][])[0][0]].sort(),
    ).toEqual([pid('gone1'), pid('gone2')]);
  });

  describe('KHÔNG phải ảnh do hệ thống tải lên ⇒ bỏ qua hoàn toàn', () => {
    it('chỉ có URL lạ: không truy vấn DB, không gọi Cloudinary', async () => {
      await service.deleteUnreferenced([
        url('a', 'demo'),
        'https://evil.example/x.jpg',
        'khong-phai-url',
        '',
      ]);

      expect(prisma.productImage.findMany).not.toHaveBeenCalled();
      expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
      expect(cloudinary.deleteImages).not.toHaveBeenCalled();
    });

    it('lẫn URL lạ và ảnh của mình: chỉ ảnh của mình được xét xoá', async () => {
      await service.deleteUnreferenced([url('mine'), url('a', 'demo')]);

      expect(cloudinary.deleteImages).toHaveBeenCalledWith([pid('mine')]);
    });
  });

  it('danh sách rỗng: không làm gì', async () => {
    await service.deleteUnreferenced([]);

    expect(prisma.productImage.findMany).not.toHaveBeenCalled();
    expect(cloudinary.deleteImages).not.toHaveBeenCalled();
  });

  it('trùng URL trong lô: chỉ xét/xoá một lần', async () => {
    await service.deleteUnreferenced([url('a'), url('a')]);

    expect(cloudinary.deleteImages).toHaveBeenCalledWith([pid('a')]);
  });

  it('kiểm tham chiếu ở cả 3 nơi (ảnh biến thể, đơn hàng, shop) bằng đúng một truy vấn mỗi bảng cho cả lô', async () => {
    await service.deleteUnreferenced([url('a'), url('b'), url('c')]);

    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.shop.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { imageUrl: { contains: pid('a') } },
          { imageUrl: { contains: pid('b') } },
          { imageUrl: { contains: pid('c') } },
        ],
      },
      select: { imageUrl: true },
    });
  });

  describe('lỗi ⇒ KHÔNG ném (đã ghi DB xong), và an toàn là không xoá gì', () => {
    it.each([
      ['product_images', () => prisma.productImage.findMany],
      ['order_items', () => prisma.orderItem.findMany],
      ['shops', () => prisma.shop.findMany],
    ])(
      'truy vấn tham chiếu %s lỗi: không xoá gì, không ném',
      async (_n, pick) => {
        pick().mockRejectedValue(new Error('db down'));

        await expect(
          service.deleteUnreferenced([url('a')]),
        ).resolves.toBeUndefined();

        expect(cloudinary.deleteImages).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalled();
      },
    );

    it('xoá trên Cloudinary lỗi bất ngờ: nuốt lỗi, không ném', async () => {
      cloudinary.deleteImages.mockRejectedValue(new Error('boom'));

      await expect(
        service.deleteUnreferenced([url('a')]),
      ).resolves.toBeUndefined();
    });

    it('lỗi không phải Error (chuỗi/undefined): vẫn không ném', async () => {
      prisma.productImage.findMany.mockRejectedValue(undefined);

      await expect(
        service.deleteUnreferenced([url('a')]),
      ).resolves.toBeUndefined();
    });

    it('log không chứa URL ảnh (chỉ thông điệp lỗi)', async () => {
      prisma.productImage.findMany.mockRejectedValue(new Error('db down'));

      await service.deleteUnreferenced([url('secret-image-name')]);

      const logged = (errorLog.mock.calls as unknown[][])
        .map((call) => String(call[0]))
        .join(' ');
      expect(logged).not.toContain('secret-image-name');
    });
  });
});
