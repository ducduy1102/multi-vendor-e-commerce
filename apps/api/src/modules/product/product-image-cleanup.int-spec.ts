import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import {
  cleanupByTag,
  createOrderWithItem,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { ProductService } from './product.service';

// Integration test trên Postgres THẬT (Week10.md 2.4) cho việc dọn ảnh sản phẩm khỏi Cloudinary và trần số ảnh.
// Chứng minh điều unit test với Prisma giả không chứng minh được: ẢNH CHỤP LẠI trong lịch sử đơn
// (order_items.image_url) giữ tệp ở lại, ảnh dùng chung giữa các biến thể giữ tệp ở lại, và dọn ảnh lỗi không
// làm hỏng việc sửa sản phẩm. Cloudinary được giả (spy `deleteImages`) nên không có request nào ra mạng.
// Chạy: `pnpm test:int`.
const TAG = 'it-img-clean-';
const CLOUD = 'it-cloud';
// Mỗi test một hậu tố riêng cho mọi id ảnh: các test dùng chung DB nên nếu dùng lại cùng id thì đơn hàng/ảnh của
// test trước vẫn "tham chiếu" tệp và làm sai kết quả (kiểm tham chiếu là tìm theo chuỗi chứa public_id). Hậu tố kết
// thúc bằng 'x' để id của test này không bao giờ là chuỗi con của id test khác.
let suffix = '';
const url = (id: string, cloud = CLOUD) =>
  `https://res.cloudinary.com/${cloud}/image/upload/v1/multi-vendor-ecommerce/${id}${suffix}.jpg`;
const pid = (id: string) => `multi-vendor-ecommerce/${id}${suffix}`;

describe('Dọn ảnh sản phẩm và trần số ảnh (DB thật)', () => {
  const prisma = new PrismaClient();
  let moduleFixture: TestingModule;
  let products: ProductService;
  let deleteImages: jest.SpyInstance;
  // Danh sách public_id ở lần gọi `deleteImages` đầu tiên (mock.calls khai kiểu `any`).
  const firstDeletedIds = (): string[] =>
    (deleteImages.mock.calls as string[][][])[0][0];
  const originalCloud = process.env.CLOUDINARY_CLOUD_NAME;
  let counter = 0;

  beforeAll(async () => {
    // getManagedPublicId chỉ nhận URL của đúng cloud trong env — đặt cloud giả để URL test được nhận ra.
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    await cleanupByTag(prisma, TAG);
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleFixture.init();
    products = moduleFixture.get(ProductService);
    deleteImages = jest.spyOn(
      moduleFixture.get(CloudinaryService),
      'deleteImages',
    );
  });

  beforeEach(() => {
    suffix = `-${Date.now().toString(36)}x${counter++}x`;
    deleteImages.mockReset();
    deleteImages.mockResolvedValue({ failed: [] });
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await moduleFixture.close();
    if (originalCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = originalCloud;
  });

  // Mỗi test một shop + sản phẩm riêng.
  async function setup() {
    const base = await createShopWithProduct(prisma, TAG);
    return base;
  }

  const variant = (sku: string, images: string[]) => ({
    sku,
    price: 100000,
    stock: 5,
    attributeValues: [],
    images,
  });
  const save = (
    base: { shopId: string; productId: string },
    variants: ReturnType<typeof variant>[],
  ) =>
    products.updateProduct(base.shopId, base.productId, {
      attributes: [],
      variants,
    });
  const skuOf = (name: string) =>
    `${name}-${Date.now().toString(36)}-${counter++}`;
  const imageRows = (productId: string) =>
    prisma.productImage.findMany({
      where: { variant: { productId } },
      select: { url: true, variant: { select: { sku: true } } },
    });

  it('gỡ một ảnh khỏi biến thể ⇒ dòng ảnh biến mất VÀ tệp được xoá trên Cloudinary', async () => {
    const base = await setup();
    const sku = skuOf('A');
    await save(base, [variant(sku, [url('keep'), url('gone')])]);
    deleteImages.mockClear();

    await save(base, [variant(sku, [url('keep')])]);

    expect((await imageRows(base.productId)).map((r) => r.url)).toEqual([
      url('keep'),
    ]);
    expect(deleteImages).toHaveBeenCalledTimes(1);
    expect(deleteImages).toHaveBeenCalledWith([pid('gone')]);
  });

  it('ảnh vẫn còn trong payload ⇒ không xoá gì', async () => {
    const base = await setup();
    const sku = skuOf('A');
    await save(base, [variant(sku, [url('a'), url('b')])]);

    await save(base, [variant(sku, [url('b'), url('a')])]); // chỉ đổi thứ tự

    expect(deleteImages).not.toHaveBeenCalled();
  });

  describe('ẢNH CHỤP LẠI trong đơn hàng (order_items.image_url) giữ tệp ở lại', () => {
    it('ảnh đã nằm trong lịch sử đơn của người mua: gỡ khỏi biến thể KHÔNG xoá tệp', async () => {
      const base = await setup();
      const buyer = await createUser(prisma, TAG);
      const sku = skuOf('A');
      await save(base, [variant(sku, [url('bought'), url('other')])]);
      const row = await prisma.productVariant.findFirstOrThrow({
        where: { productId: base.productId, sku },
        select: { id: true },
      });
      await createOrderWithItem(prisma, {
        userId: buyer.id,
        shopId: base.shopId,
        variantId: row.id,
        imageUrl: url('bought'),
      });
      deleteImages.mockClear();

      await save(base, [variant(sku, [])]); // gỡ CẢ HAI ảnh

      // Dòng ảnh đã bị xoá khỏi biến thể…
      expect(await imageRows(base.productId)).toEqual([]);
      // …nhưng tệp "bought" còn trong lịch sử đơn nên GIỮ; chỉ "other" (không ai tham chiếu) bị xoá.
      expect(deleteImages).toHaveBeenCalledTimes(1);
      expect(deleteImages).toHaveBeenCalledWith([pid('other')]);
    });

    it('nếu không có đơn nào: cùng thao tác đó xoá cả hai tệp (đối chứng — chứng minh chính snapshot đơn mới giữ tệp)', async () => {
      const base = await setup();
      const sku = skuOf('A');
      await save(base, [variant(sku, [url('bought'), url('other')])]);
      deleteImages.mockClear();

      await save(base, [variant(sku, [])]);

      expect(deleteImages).toHaveBeenCalledTimes(1);
      expect([...firstDeletedIds()].sort()).toEqual(
        [pid('bought'), pid('other')].sort(),
      );
    });
  });

  describe('ảnh dùng chung / chuyển chỗ', () => {
    it('cùng một ảnh ở hai biến thể: gỡ khỏi một biến thể GIỮ tệp, gỡ nốt biến thể kia thì XOÁ', async () => {
      const base = await setup();
      const a = skuOf('A');
      const b = skuOf('B');
      await save(base, [
        variant(a, [url('shared')]),
        variant(b, [url('shared')]),
      ]);
      deleteImages.mockClear();

      await save(base, [variant(a, []), variant(b, [url('shared')])]);
      expect(deleteImages).not.toHaveBeenCalled();

      await save(base, [variant(a, []), variant(b, [])]);
      expect(deleteImages).toHaveBeenCalledWith([pid('shared')]);
    });

    it('chuyển ảnh từ biến thể A sang B trong CÙNG lần sửa: không xoá (đang được B dùng)', async () => {
      const base = await setup();
      const a = skuOf('A');
      const b = skuOf('B');
      await save(base, [variant(a, [url('moving')]), variant(b, [])]);
      deleteImages.mockClear();

      await save(base, [variant(a, []), variant(b, [url('moving')])]);

      expect(deleteImages).not.toHaveBeenCalled();
      expect((await imageRows(base.productId)).map((r) => r.url)).toEqual([
        url('moving'),
      ]);
    });

    it('ảnh đang là logo/banner của shop: gỡ khỏi biến thể KHÔNG xoá tệp', async () => {
      const base = await setup();
      const sku = skuOf('A');
      await save(base, [
        variant(sku, [url('logo'), url('banner'), url('plain')]),
      ]);
      await prisma.shop.update({
        where: { id: base.shopId },
        data: { logoUrl: url('logo'), bannerUrl: url('banner') },
      });
      deleteImages.mockClear();

      await save(base, [variant(sku, [])]);

      expect(deleteImages).toHaveBeenCalledWith([pid('plain')]);
    });

    it('ảnh dùng chung với biến thể của SẢN PHẨM KHÁC: giữ tệp', async () => {
      const base = await setup();
      const other = await setup();
      const skuA = skuOf('A');
      const skuB = skuOf('B');
      await save(base, [variant(skuA, [url('cross')])]);
      await save(other, [variant(skuB, [url('cross')])]);
      deleteImages.mockClear();

      await save(base, [variant(skuA, [])]);

      expect(deleteImages).not.toHaveBeenCalled();
    });
  });

  describe('gỡ biến thể (soft-delete)', () => {
    it('xoá dòng ảnh của biến thể bị gỡ và xoá tệp nếu không ai tham chiếu', async () => {
      const base = await setup();
      const keep = skuOf('KEEP');
      const drop = skuOf('DROP');
      await save(base, [
        variant(keep, []),
        variant(drop, [url('d1'), url('d2')]),
      ]);
      deleteImages.mockClear();

      await save(base, [variant(keep, [])]);

      const dropped = await prisma.productVariant.findFirstOrThrow({
        where: { productId: base.productId, sku: drop },
        select: { isActive: true },
      });
      expect(dropped.isActive).toBe(false);
      expect(await imageRows(base.productId)).toEqual([]);
      expect([...firstDeletedIds()].sort()).toEqual(
        [pid('d1'), pid('d2')].sort(),
      );
    });

    it('biến thể bị gỡ nhưng ảnh còn trong lịch sử đơn: dòng ảnh bị xoá, tệp GIỮ', async () => {
      const base = await setup();
      const buyer = await createUser(prisma, TAG);
      const keep = skuOf('KEEP');
      const drop = skuOf('DROP');
      await save(base, [variant(keep, []), variant(drop, [url('sold')])]);
      const dropRow = await prisma.productVariant.findFirstOrThrow({
        where: { productId: base.productId, sku: drop },
        select: { id: true },
      });
      await createOrderWithItem(prisma, {
        userId: buyer.id,
        shopId: base.shopId,
        variantId: dropRow.id,
        imageUrl: url('sold'),
      });
      deleteImages.mockClear();

      await save(base, [variant(keep, [])]);

      expect(deleteImages).not.toHaveBeenCalled();
    });
  });

  describe('chỉ xoá ảnh do chính hệ thống tải lên', () => {
    it('URL của cloud khác (vd ảnh mẫu) hoặc URL tự nhập: không bao giờ gọi xoá', async () => {
      const base = await setup();
      const sku = skuOf('A');
      await save(base, [
        variant(sku, [
          url('x', 'demo'),
          'https://example.com/anh-tu-nhap.jpg',
          `https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w_100/v1/multi-vendor-ecommerce/t.jpg`,
        ]),
      ]);
      deleteImages.mockClear();

      await save(base, [variant(sku, [])]);

      expect(deleteImages).not.toHaveBeenCalled();
      expect(await imageRows(base.productId)).toEqual([]);
    });
  });

  describe('lỗi khi dọn không làm hỏng việc sửa sản phẩm', () => {
    it('Cloudinary từ chối xoá: sản phẩm vẫn được lưu, ảnh đã gỡ khỏi DB', async () => {
      const base = await setup();
      const sku = skuOf('A');
      await save(base, [variant(sku, [url('a'), url('b')])]);
      deleteImages.mockRejectedValue(new Error('Cloudinary down'));

      await expect(
        save(base, [variant(sku, [url('a')])]),
      ).resolves.toBeDefined();

      expect((await imageRows(base.productId)).map((r) => r.url)).toEqual([
        url('a'),
      ]);
    });

    it('giao dịch rollback GIỮA CHỪNG ⇒ ảnh đã gỡ ở biến thể trước được khôi phục và KHÔNG xoá tệp', async () => {
      const base = await setup();
      const a = skuOf('A');
      const b = skuOf('B');
      await save(base, [variant(a, [url('a1'), url('a2')]), variant(b, [])]);
      // B đang giữ chỗ 5 đơn ⇒ hạ kho của B xuống 1 sẽ vi phạm bất biến và làm cả giao dịch rollback.
      await prisma.productVariant.updateMany({
        where: { productId: base.productId, sku: b },
        data: { stock: 5, reservedStock: 5 },
      });
      deleteImages.mockClear();

      // A được xử lý TRƯỚC (đã xoá dòng ảnh a2 trong giao dịch), rồi B ném lỗi ⇒ rollback toàn bộ.
      await expect(
        save(base, [variant(a, [url('a1')]), { ...variant(b, []), stock: 1 }]),
      ).rejects.toThrow();

      expect(
        (await imageRows(base.productId)).map((r) => r.url).sort(),
      ).toEqual([url('a1'), url('a2')].sort());
      expect(deleteImages).not.toHaveBeenCalled();
    });
  });

  describe('trần số ảnh mỗi biến thể trên DB thật', () => {
    const urls = (count: number) =>
      Array.from({ length: count }, (_, i) => url(`img${i}`));

    it('tạo sản phẩm mới với 10 ảnh: 400 PRODUCT_IMAGES_LIMIT_EXCEEDED, không tạo gì', async () => {
      const { shopId, productId } = await setup();
      const before = await prisma.product.count({ where: { shopId } });

      await expectAppException(
        products.createProduct(shopId, {
          name: `${TAG}tao-moi`,
          categoryId: (
            await prisma.product.findUniqueOrThrow({
              where: { id: productId },
              select: { categoryId: true },
            })
          ).categoryId,
          description: undefined,
          attributes: [],
          variants: [variant(skuOf('N'), urls(10))],
        }),
        { status: 400, code: 'PRODUCT_IMAGES_LIMIT_EXCEEDED' },
      );

      expect(await prisma.product.count({ where: { shopId } })).toBe(before);
    });

    it('đúng 9 ảnh: lưu được', async () => {
      const base = await setup();

      await expect(
        save(base, [variant(skuOf('A'), urls(9))]),
      ).resolves.toBeDefined();
    });

    it('thêm lên 10 ảnh: bị chặn và DB giữ nguyên 9 ảnh cũ', async () => {
      const base = await setup();
      const sku = skuOf('A');
      await save(base, [variant(sku, urls(9))]);

      await expectAppException(save(base, [variant(sku, urls(10))]), {
        status: 400,
        code: 'PRODUCT_IMAGES_LIMIT_EXCEEDED',
      });

      expect(await imageRows(base.productId)).toHaveLength(9);
    });

    it('GRANDFATHER: biến thể cũ có 12 ảnh (ghi thẳng DB, như dữ liệu trước khi có trần) vẫn sửa giá/kho được', async () => {
      const base = await setup();
      const sku = skuOf('OLD');
      await save(base, [variant(sku, [])]);
      const row = await prisma.productVariant.findFirstOrThrow({
        where: { productId: base.productId, sku },
        select: { id: true },
      });
      await prisma.productImage.createMany({
        data: urls(12).map((u, position) => ({
          variantId: row.id,
          url: u,
          position,
        })),
      });
      deleteImages.mockClear();

      // Giữ nguyên 12 ảnh, chỉ đổi giá: KHÔNG bị chặn.
      await expect(
        save(base, [{ ...variant(sku, urls(12)), price: 250000 }]),
      ).resolves.toBeDefined();
      expect(await imageRows(base.productId)).toHaveLength(12);

      // Bớt 2 ảnh (vẫn 10 > trần nhưng không tăng): được phép, và 2 tệp bị gỡ được dọn.
      await save(base, [variant(sku, urls(10))]);
      expect(await imageRows(base.productId)).toHaveLength(10);
      expect([...firstDeletedIds()].sort()).toEqual(
        [pid('img10'), pid('img11')].sort(),
      );

      // Thêm lên 11 khi đang 10 (> trần): bị chặn.
      await expectAppException(save(base, [variant(sku, urls(11))]), {
        status: 400,
        code: 'PRODUCT_IMAGES_LIMIT_EXCEEDED',
      });
    });
  });
});
