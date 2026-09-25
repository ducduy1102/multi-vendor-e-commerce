import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CreateProductDto } from './dto/create-product.dto';
import { ProductService } from './product.service';

function p2002(
  modelName: 'Product' | 'ProductVariant' = 'Product',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { modelName },
  });
}

const baseDto: CreateProductDto = {
  name: 'Áo thun nam',
  categoryId: 'cat-1',
  description: undefined,
  attributes: [
    { name: 'Màu sắc', values: [{ value: 'Đỏ' }, { value: 'Xanh' }] },
    { name: 'Size', values: [{ value: 'M' }, { value: 'L' }] },
  ],
  variants: [
    {
      sku: 'AT-DO-M',
      price: 150000,
      stock: 10,
      attributeValues: ['Đỏ', 'M'],
      images: [],
    },
    {
      sku: 'AT-DO-L',
      price: 150000,
      stock: 8,
      attributeValues: ['Đỏ', 'L'],
      images: [],
    },
  ],
};

describe('ProductService', () => {
  let service: ProductService;
  let prisma: {
    product: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    category: { findMany: jest.Mock };
    productAttribute: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    productAttributeValue: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    productVariant: {
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    variantAttributeValue: { createMany: jest.Mock; deleteMany: jest.Mock };
    productImage: {
      create: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'product-1', ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      productAttribute: {
        create: jest.fn((args: { data: { name: string } }) =>
          Promise.resolve({ id: `attr-${args.data.name}` }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      productAttributeValue: {
        create: jest.fn(
          (args: { data: { attributeId: string; value: string } }) =>
            Promise.resolve({
              id: `val-${args.data.attributeId}-${args.data.value}`,
            }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      productVariant: {
        create: jest.fn((args: { data: { sku: string } }) =>
          Promise.resolve({ id: `variant-${args.data.sku}` }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      variantAttributeValue: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productImage: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
      // $queryRaw dùng cho search full-text (Week5.md Bước 2.5) — Prisma mock
      // này là 1 hàm (tagged template), không phải object có method như
      // product/category..., nên mock trực tiếp bằng jest.fn() trả mảng rỗng
      // mặc định (không có q thì không gọi tới, có q mà không match gì cũng
      // hợp lệ).
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new ProductService(prisma as unknown as PrismaService);
  });

  function mockLoadedProduct(overrides: Record<string, unknown> = {}) {
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Áo thun nam',
      slug: 'ao-thun-nam',
      description: undefined,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: [],
      variants: [],
      ...overrides,
    });
  }

  it('tạo product kèm attributes + variants đúng trong 1 transaction', async () => {
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Áo thun nam',
      slug: 'ao-thun-nam',
      description: undefined,
      status: 'DRAFT',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      attributes: [
        {
          id: 'attr-Màu sắc',
          name: 'Màu sắc',
          position: 0,
          values: [
            { id: 'val-attr-Màu sắc-Đỏ', value: 'Đỏ' },
            { id: 'val-attr-Màu sắc-Xanh', value: 'Xanh' },
          ],
        },
        {
          id: 'attr-Size',
          name: 'Size',
          position: 1,
          values: [
            { id: 'val-attr-Size-M', value: 'M' },
            { id: 'val-attr-Size-L', value: 'L' },
          ],
        },
      ],
      variants: [
        {
          id: 'variant-AT-DO-M',
          sku: 'AT-DO-M',
          price: new Prisma.Decimal(150000),
          stock: 10,
          isActive: true,
          images: [],
          weightGram: null,
          attributeValues: [
            {
              attributeValue: { value: 'Đỏ', attribute: { name: 'Màu sắc' } },
            },
            { attributeValue: { value: 'M', attribute: { name: 'Size' } } },
          ],
        },
      ],
    });

    const result = await service.createProduct('shop-1', baseDto);

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        shopId: 'shop-1',
        categoryId: 'cat-1',
        name: 'Áo thun nam',
        slug: 'ao-thun-nam',
        description: undefined,
        minPrice: 150000,
        maxPrice: 150000,
      },
      select: { id: true },
    });

    // 2 thuộc tính, đúng position theo thứ tự khai trong payload.
    expect(prisma.productAttribute.create).toHaveBeenNthCalledWith(1, {
      data: { productId: 'product-1', name: 'Màu sắc', position: 0 },
      select: { id: true },
    });
    expect(prisma.productAttribute.create).toHaveBeenNthCalledWith(2, {
      data: { productId: 'product-1', name: 'Size', position: 1 },
      select: { id: true },
    });
    expect(prisma.productAttributeValue.create).toHaveBeenCalledTimes(4);

    // Variant gán đúng shopId đã xác nhận qua guard (không có field này
    // trong dto) — không phải giá trị nào FE có thể tự gửi lên.
    expect(prisma.productVariant.create).toHaveBeenNthCalledWith(1, {
      data: {
        productId: 'product-1',
        shopId: 'shop-1',
        sku: 'AT-DO-M',
        price: 150000,
        stock: 10,
      },
      select: { id: true },
    });
    // images rỗng (baseDto không kèm ảnh nào) -> không tạo ProductImage nào.
    expect(prisma.productImage.createMany).not.toHaveBeenCalled();

    // attributeValues[0]="Đỏ" khớp attributes[0] (Màu sắc), attributeValues[1]="M"
    // khớp attributes[1] (Size) — tra theo vị trí, không theo tên.
    expect(prisma.variantAttributeValue.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        {
          variantId: 'variant-AT-DO-M',
          attributeValueId: 'val-attr-Màu sắc-Đỏ',
        },
        { variantId: 'variant-AT-DO-M', attributeValueId: 'val-attr-Size-M' },
      ],
    });

    // Response đã flatten attributeValues thành {attributeName, value}.
    expect(result.variants[0].attributeValues).toEqual([
      { attributeName: 'Màu sắc', value: 'Đỏ' },
      { attributeName: 'Size', value: 'M' },
    ]);
  });

  it('sản phẩm không có attribute vẫn tạo được 1 variant duy nhất', async () => {
    const dto: CreateProductDto = {
      name: 'Sản phẩm đơn giản',
      categoryId: 'cat-1',
      description: undefined,
      attributes: [],
      variants: [
        {
          sku: 'SP-DON',
          price: 50000,
          stock: 5,
          attributeValues: [],
          images: [],
        },
      ],
    };
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Sản phẩm đơn giản',
      slug: 'san-pham-don-gian',
      description: undefined,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: [],
      variants: [
        {
          id: 'variant-SP-DON',
          sku: 'SP-DON',
          price: new Prisma.Decimal(50000),
          stock: 5,
          isActive: true,
          images: [],
          weightGram: null,
          attributeValues: [],
        },
      ],
    });

    await service.createProduct('shop-1', dto);

    expect(prisma.productAttribute.create).not.toHaveBeenCalled();
    expect(prisma.productAttributeValue.create).not.toHaveBeenCalled();
    expect(prisma.variantAttributeValue.createMany).not.toHaveBeenCalled();
  });

  // Week5.md Bước 1.3/2.12 — tạo product kèm nhiều ảnh/variant đúng trong
  // cùng transaction, position = đúng thứ tự trong mảng images.
  it('tạo product kèm nhiều ảnh/variant, position theo đúng thứ tự mảng', async () => {
    mockLoadedProduct({ variants: [] });

    await service.createProduct('shop-1', {
      ...baseDto,
      attributes: [],
      variants: [
        {
          sku: 'X',
          price: 1,
          stock: 1,
          attributeValues: [],
          images: ['https://x/a.jpg', 'https://x/b.jpg'],
        },
      ],
    });

    expect(prisma.productImage.createMany).toHaveBeenCalledWith({
      data: [
        { variantId: 'variant-X', url: 'https://x/a.jpg', position: 0 },
        { variantId: 'variant-X', url: 'https://x/b.jpg', position: 1 },
      ],
    });
  });

  it('tự sinh slug, thêm hậu tố khi slug gốc đã bị chiếm', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'existing' }) // "ao-thun-nam" đã tồn tại
      .mockResolvedValueOnce(null); // "ao-thun-nam-2" còn trống
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: baseDto.name,
      slug: 'ao-thun-nam-2',
      description: undefined,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: [],
      variants: [],
    });

    await service.createProduct('shop-1', {
      ...baseDto,
      attributes: [],
      variants: [
        {
          sku: 'X',
          price: 1,
          stock: 1,
          attributeValues: [],
          images: [],
        },
      ],
    });

    expect(prisma.product.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        shopId: 'shop-1',
        categoryId: baseDto.categoryId,
        name: baseDto.name,
        slug: 'ao-thun-nam-2',
        description: baseDto.description,
        minPrice: 1,
        maxPrice: 1,
      },
      select: { id: true },
    });
  });

  it('race condition P2002 lúc commit — thử lại với slug kế tiếp', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.$transaction
      .mockImplementationOnce(() => Promise.reject(p2002()))
      .mockImplementationOnce((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(prisma)),
      );
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: baseDto.name,
      slug: 'ao-thun-nam-2',
      description: undefined,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: [],
      variants: [],
    });

    await service.createProduct('shop-1', {
      ...baseDto,
      attributes: [],
      variants: [
        {
          sku: 'X',
          price: 1,
          stock: 1,
          attributeValues: [],
          images: [],
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('hết lượt thử (mọi slug đều trùng) — báo 409 Slug already exists', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createProduct('shop-1', baseDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lỗi khác không phải slug conflict thì rethrow, không thử lại', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    const otherError = new Error('DB down');
    prisma.$transaction.mockRejectedValue(otherError);

    await expect(service.createProduct('shop-1', baseDto)).rejects.toBe(
      otherError,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('1 phần transaction lỗi giữa đường (vd tạo variant thứ 2 fail) — rethrow ngay, dừng luôn không tạo tiếp', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    const dbError = new Error('DB write failed');
    prisma.productVariant.create
      .mockImplementationOnce((args: { data: { sku: string } }) =>
        Promise.resolve({ id: `variant-${args.data.sku}` }),
      )
      .mockImplementationOnce(() => Promise.reject(dbError));

    await expect(service.createProduct('shop-1', baseDto)).rejects.toBe(
      dbError,
    );

    // Variant đầu tạo xong (kèm link) thì variant thứ 2 mới lỗi — dừng
    // ngay, không lặp tiếp. $transaction thật (Prisma) sẽ rollback toàn bộ
    // Product + variant đầu tiên đã "tạo" trong cùng transaction này, không
    // để lại record mồ côi — đây là lý do createProduct bọc mọi thứ trong 1
    // $transaction duy nhất thay vì nhiều lệnh rời rạc.
    expect(prisma.productVariant.create).toHaveBeenCalledTimes(2);
    expect(prisma.variantAttributeValue.createMany).toHaveBeenCalledTimes(1);
  });

  it('P2002 do trùng SKU (ProductVariant) báo đúng lý do, không hiểu lầm thành trùng slug', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(p2002('ProductVariant'));

    await expect(
      service.createProduct('shop-1', baseDto),
    ).rejects.toMatchObject({
      message: 'SKU already exists in this shop',
      status: 409,
    });
    // Không tự thử lại slug khác — vấn đề không phải ở slug, thử lại vô nghĩa.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  describe('updateProduct', () => {
    it('chỉ sửa field cơ bản khi không gửi attributes/variants', async () => {
      mockLoadedProduct({ name: 'Tên mới', status: 'PUBLISHED' });

      await service.updateProduct('shop-1', 'product-1', {
        name: 'Tên mới',
        status: 'PUBLISHED',
      });

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: {
          name: 'Tên mới',
          categoryId: undefined,
          description: undefined,
          status: 'PUBLISHED',
        },
      });
      expect(prisma.productAttribute.findFirst).not.toHaveBeenCalled();
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    // Reconcile attribute/value theo `id` (không còn theo name/value text) —
    // bug thật đã fix: match theo text khiến ĐỔI TÊN (không phải xoá) bị
    // hiểu nhầm thành "xoá cũ + tạo mới", để lại row rác vĩnh viễn (attribute/
    // value không hard-delete, xem note-db.md mục 5d). Đã verify thực tế:
    // đổi tên 1 attribute 4 lần liên tiếp qua API thật để lại 3 row
    // product_attributes + 3 row product_attribute_values chết trước khi fix.
    describe('reconcile attribute/value theo id', () => {
      it('attribute rename qua id: update tại chỗ (không tạo mới), giữ nguyên id', async () => {
        prisma.productAttribute.findFirst.mockResolvedValueOnce({
          id: 'attr-1',
        });
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [
            { id: 'attr-1', name: 'Màu sắc mới', values: [{ value: 'Đỏ' }] },
          ],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['Đỏ'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttribute.findFirst).toHaveBeenCalledWith({
          where: { id: 'attr-1', productId: 'product-1' },
          select: { id: true },
        });
        expect(prisma.productAttribute.create).not.toHaveBeenCalled();
        expect(prisma.productAttribute.update).toHaveBeenCalledWith({
          where: { id: 'attr-1' },
          data: { name: 'Màu sắc mới', position: 0 },
        });
      });

      it('attribute không có id: luôn tạo mới, không gọi findFirst (short-circuit)', async () => {
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [{ name: 'Size', values: [{ value: 'M' }] }],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['M'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttribute.findFirst).not.toHaveBeenCalled();
        expect(prisma.productAttribute.create).toHaveBeenCalledWith({
          data: { productId: 'product-1', name: 'Size', position: 0 },
          select: { id: true },
        });
      });

      it('attribute có id nhưng không resolve được (lạ/thuộc product khác): fallback tạo mới, không lỗi', async () => {
        prisma.productAttribute.findFirst.mockResolvedValueOnce(null);
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [
            {
              id: 'attr-of-other-product',
              name: 'Màu sắc',
              values: [{ value: 'Đỏ' }],
            },
          ],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['Đỏ'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttribute.create).toHaveBeenCalledWith({
          data: { productId: 'product-1', name: 'Màu sắc', position: 0 },
          select: { id: true },
        });
        expect(prisma.productAttribute.update).not.toHaveBeenCalled();
      });

      it('value rename qua id (attribute name giữ nguyên): update tại chỗ, không tạo mới', async () => {
        prisma.productAttribute.findFirst.mockResolvedValueOnce({
          id: 'attr-1',
        });
        prisma.productAttributeValue.findFirst.mockResolvedValueOnce({
          id: 'val-1',
        });
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [
            {
              id: 'attr-1',
              name: 'Màu sắc',
              values: [{ id: 'val-1', value: 'Đỏ tươi' }],
            },
          ],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['Đỏ tươi'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttributeValue.findFirst).toHaveBeenCalledWith({
          where: { id: 'val-1', attributeId: 'attr-1' },
          select: { id: true },
        });
        expect(prisma.productAttributeValue.create).not.toHaveBeenCalled();
        expect(prisma.productAttributeValue.update).toHaveBeenCalledWith({
          where: { id: 'val-1' },
          data: { value: 'Đỏ tươi' },
        });

        // Variant vẫn link đúng valueId CŨ (val-1, không tạo id mới) — map
        // valueIdByValue được rebuild dùng đúng text vừa rename ("Đỏ tươi"),
        // khớp với attributeValues variant vừa gửi cùng request.
        expect(prisma.variantAttributeValue.createMany).toHaveBeenCalledWith({
          data: [{ variantId: 'variant-X', attributeValueId: 'val-1' }],
        });
      });

      it('value không có id: luôn tạo mới, không gọi findFirst', async () => {
        prisma.productAttribute.findFirst.mockResolvedValueOnce({
          id: 'attr-1',
        });
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [
            { id: 'attr-1', name: 'Màu sắc', values: [{ value: 'Vàng' }] },
          ],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['Vàng'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttributeValue.findFirst).not.toHaveBeenCalled();
        expect(prisma.productAttributeValue.create).toHaveBeenCalledWith({
          data: { attributeId: 'attr-1', value: 'Vàng' },
          select: { id: true },
        });
      });

      it('value có id nhưng không thuộc attributeId đang resolve: fallback tạo mới', async () => {
        prisma.productAttribute.findFirst.mockResolvedValueOnce({
          id: 'attr-1',
        });
        prisma.productAttributeValue.findFirst.mockResolvedValueOnce(null);
        mockLoadedProduct();

        await service.updateProduct('shop-1', 'product-1', {
          attributes: [
            {
              id: 'attr-1',
              name: 'Màu sắc',
              values: [{ id: 'val-of-other-attribute', value: 'Đỏ' }],
            },
          ],
          variants: [
            {
              sku: 'X',
              price: 1,
              stock: 1,
              attributeValues: ['Đỏ'],
              images: [],
            },
          ],
        });

        expect(prisma.productAttributeValue.findFirst).toHaveBeenCalledWith({
          where: { id: 'val-of-other-attribute', attributeId: 'attr-1' },
          select: { id: true },
        });
        expect(prisma.productAttributeValue.create).toHaveBeenCalledWith({
          data: { attributeId: 'attr-1', value: 'Đỏ' },
          select: { id: true },
        });
        expect(prisma.productAttributeValue.update).not.toHaveBeenCalled();
      });

      it('đổi tên attribute+value 4 lần liên tiếp qua cùng id KHÔNG tạo row rác (regression bug thật đã fix)', async () => {
        mockLoadedProduct();
        const names = ['Mau', 'Size', 'Color', 'Loai'];
        const values = ['Do', 'Do', 'Do', 'Do'];

        for (let i = 0; i < names.length; i++) {
          // Từ lần 2 trở đi, "đã tồn tại" đúng theo id đã có từ lần đầu —
          // mô phỏng đúng cách 1 client thật (form đã giữ id) sẽ gửi lại.
          if (i > 0) {
            prisma.productAttribute.findFirst.mockResolvedValueOnce({
              id: 'attr-1',
            });
            prisma.productAttributeValue.findFirst.mockResolvedValueOnce({
              id: 'val-1',
            });
          }

          await service.updateProduct('shop-1', 'product-1', {
            attributes: [
              {
                id: i > 0 ? 'attr-1' : undefined,
                name: names[i],
                values: [{ id: i > 0 ? 'val-1' : undefined, value: values[i] }],
              },
            ],
            variants: [
              {
                sku: 'X',
                price: 1,
                stock: 1,
                attributeValues: [values[i]],
                images: [],
              },
            ],
          });
        }

        // Lần đầu (i=0, không có id) mới thật sự tạo mới — 3 lần sau chỉ
        // update, không tạo thêm row nào (khác hành vi cũ: mỗi lần đổi tên
        // đều tạo mới, để lại rác).
        expect(prisma.productAttribute.create).toHaveBeenCalledTimes(1);
        expect(prisma.productAttributeValue.create).toHaveBeenCalledTimes(1);
        expect(prisma.productAttribute.update).toHaveBeenCalledTimes(3);
        expect(prisma.productAttributeValue.update).toHaveBeenCalledTimes(3);
        // Luôn nhắm đúng cùng 1 id qua cả 3 lần update — ép kiểu tường minh
        // 1 lần (jest.Mock's .mock.calls vốn kiểu any[]), cùng pattern
        // queryRawValues() đã dùng ở file này (Week5.md Bước 2.10).
        const updateCalls = prisma.productAttribute.update.mock
          .calls as unknown as { where: { id: string } }[][];
        for (const [call] of updateCalls) {
          expect(call.where).toEqual({ id: 'attr-1' });
        }
      });
    });

    it('reconcile variant: update khớp sku, tạo mới sku lạ, soft-delete sku bị bỏ và giữ nguyên link cũ', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'variant-keep', sku: 'KEEP' },
        { id: 'variant-drop', sku: 'DROP' },
      ]);
      mockLoadedProduct();

      await service.updateProduct('shop-1', 'product-1', {
        attributes: [],
        variants: [
          {
            sku: 'KEEP',
            price: 200000,
            stock: 3,
            attributeValues: [],
            images: [],
          },
          {
            sku: 'NEW',
            price: 100000,
            stock: 1,
            attributeValues: [],
            images: [],
          },
        ],
      });

      // sku "KEEP" khớp variant có sẵn -> update, không tạo mới.
      expect(prisma.productVariant.create).toHaveBeenCalledTimes(1);
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-keep' },
        data: { price: 200000, stock: 3, isActive: true },
      });

      // sku "NEW" không khớp -> tạo mới với đúng shopId đã xác nhận qua guard.
      expect(prisma.productVariant.create).toHaveBeenCalledWith({
        data: {
          productId: 'product-1',
          shopId: 'shop-1',
          sku: 'NEW',
          price: 100000,
          stock: 1,
        },
        select: { id: true },
      });

      // sku "DROP" (có trong DB, không có trong payload) -> soft-delete,
      // KHÔNG gọi deleteMany link cho variant này (chỉ deleteMany cho 2
      // variant có mặt trong payload: "KEEP" và "NEW").
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-drop' },
        data: { isActive: false },
      });
      expect(prisma.variantAttributeValue.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.variantAttributeValue.deleteMany).not.toHaveBeenCalledWith({
        where: { variantId: 'variant-drop' },
      });

      // minPrice/maxPrice tính lại từ đúng payload variants (KEEP=200000,
      // NEW=100000) — variant "DROP" bị soft-delete không còn tính vào.
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { minPrice: 100000, maxPrice: 200000 },
      });
    });

    // Week5.md Bước 1.3/2.12 — reconcile ảnh theo khoá tự nhiên (url), khác
    // soft-delete của variant: ảnh không còn trong payload bị xoá hẳn row.
    it('reconcile ảnh: giữ ảnh còn trong payload, thêm ảnh mới, xoá hẳn ảnh mất trong payload', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'variant-keep', sku: 'KEEP' },
      ]);
      prisma.productImage.findMany.mockResolvedValue([
        { id: 'img-old', url: 'https://x/old.jpg', position: 0 },
        { id: 'img-move', url: 'https://x/move.jpg', position: 1 },
      ]);
      mockLoadedProduct();

      await service.updateProduct('shop-1', 'product-1', {
        attributes: [],
        variants: [
          {
            sku: 'KEEP',
            price: 1,
            stock: 1,
            attributeValues: [],
            // "old.jpg" mất khỏi payload -> xoá hẳn. "move.jpg" còn nhưng đổi
            // sang position 0 -> chỉ update position, giữ nguyên id. "new.jpg"
            // chưa từng có -> tạo mới ở position 1.
            images: ['https://x/move.jpg', 'https://x/new.jpg'],
          },
        ],
      });

      expect(prisma.productImage.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['img-old'] } },
      });
      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: 'img-move' },
        data: { position: 0 },
      });
      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: {
          variantId: 'variant-keep',
          url: 'https://x/new.jpg',
          position: 1,
        },
      });
    });

    it('P2002 do trùng SKU với variant khác trong shop báo đúng 409, không lộ lỗi Prisma thô', async () => {
      prisma.$transaction.mockRejectedValue(p2002('ProductVariant'));

      await expect(
        service.updateProduct('shop-1', 'product-1', {
          attributes: [],
          variants: [
            {
              sku: 'DA-TON-TAI',
              price: 1,
              stock: 1,
              attributeValues: [],
              images: [],
            },
          ],
        }),
      ).rejects.toMatchObject({
        message: 'SKU already exists in this shop',
        status: 409,
      });
    });
  });

  describe('archiveProduct', () => {
    it('update status = ARCHIVED, không prisma.delete', async () => {
      mockLoadedProduct({ status: 'ARCHIVED' });

      const result = await service.archiveProduct('product-1');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { status: 'ARCHIVED' },
      });
      expect(result.status).toBe('ARCHIVED');
    });
  });

  describe('getMyProducts', () => {
    it('trả mọi status của đúng shop, mới nhất trước, select gọn (không join attributeValues)', async () => {
      const rows = [
        { id: 'p-draft', status: 'DRAFT' },
        { id: 'p-published', status: 'PUBLISHED' },
        { id: 'p-archived', status: 'ARCHIVED' },
      ];
      prisma.product.findMany.mockResolvedValue(rows);

      const result = await service.getMyProducts('shop-1');

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { shopId: 'shop-1' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          categoryId: true,
          name: true,
          slug: true,
          status: true,
          minPrice: true,
          maxPrice: true,
          createdAt: true,
          updatedAt: true,
          variants: {
            select: {
              id: true,
              sku: true,
              price: true,
              stock: true,
              isActive: true,
              images: {
                orderBy: { position: 'asc' },
                select: { url: true, position: true },
              },
            },
          },
        },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getProduct', () => {
    function mockDetailRow(overrides: Record<string, unknown> = {}) {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-1',
        shopId: 'shop-1',
        categoryId: 'cat-1',
        name: 'Áo thun nam',
        slug: 'ao-thun-nam',
        description: undefined,
        status: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
        attributes: [],
        variants: [],
        shop: {
          name: 'ABC Shop',
          slug: 'abc-shop',
          ownerId: 'owner-1',
          status: 'APPROVED',
        },
        ...overrides,
      });
    }

    it('404 nếu product không tồn tại', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.getProduct('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // Week5.md Bước 1.4 — quay lại hướng a (id HOẶC slug) sau khi phát hiện
    // bug thật: hướng b (chỉ lookup theo slug, Bước 2.1) đã bịt đường FE
    // seller fetch lại product của mình theo id thật lúc mở trang edit
    // (/seller/products/:id/edit, dùng chung đúng endpoint này từ Tuần 4).
    it('lookup theo id HOẶC slug (findFirst + OR, không phải findUnique theo mỗi slug)', async () => {
      mockDetailRow({ status: 'PUBLISHED' });

      await service.getProduct('ao-thun-nam');

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ id: 'ao-thun-nam' }, { slug: 'ao-thun-nam' }] },
        }),
      );
    });

    it('chủ shop xem lại được product của mình khi truyền id thật (luồng trang seller edit)', async () => {
      mockDetailRow({ status: 'DRAFT' });

      const result = await service.getProduct('product-1', 'owner-1');

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ id: 'product-1' }, { slug: 'product-1' }] },
        }),
      );
      expect(result.id).toBe('product-1');
    });

    it('guest/public xem được product PUBLISHED của shop APPROVED', async () => {
      mockDetailRow({ status: 'PUBLISHED' });

      const result = await service.getProduct('product-1');
      expect(result.id).toBe('product-1');
    });

    it('chỉ lộ shop.name/slug ra response — KHÔNG lộ ownerId/status (chỉ dùng nội bộ để check quyền xem)', async () => {
      mockDetailRow({ status: 'PUBLISHED' });

      const result = await service.getProduct('product-1');
      expect(result.shop).toEqual({ name: 'ABC Shop', slug: 'abc-shop' });
    });

    it('guest/public KHÔNG xem được product DRAFT — 404 (không lộ có tồn tại)', async () => {
      mockDetailRow({ status: 'DRAFT' });

      await expect(service.getProduct('product-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('guest/public KHÔNG xem được product PUBLISHED nếu shop chưa APPROVED', async () => {
      mockDetailRow({
        status: 'PUBLISHED',
        shop: {
          name: 'ABC Shop',
          slug: 'abc-shop',
          ownerId: 'owner-1',
          status: 'PENDING',
        },
      });

      await expect(service.getProduct('product-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('chủ shop xem được product của mình dù đang DRAFT', async () => {
      mockDetailRow({ status: 'DRAFT' });

      const result = await service.getProduct('product-1', 'owner-1');
      expect(result.id).toBe('product-1');
    });

    it('user đã đăng nhập nhưng không phải chủ shop vẫn bị chặn như guest', async () => {
      mockDetailRow({ status: 'DRAFT' });

      await expect(
        service.getProduct('product-1', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPublicProducts', () => {
    const baseQuery = {
      page: 1,
      limit: 12,
      sort: 'newest' as const,
    };

    it('luôn filter status=PUBLISHED + shop.status=APPROVED, sort mới nhất mặc định', async () => {
      await service.listPublicProducts(baseQuery);

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED', shop: { status: 'APPROVED' } },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 12,
        select: {
          id: true,
          categoryId: true,
          name: true,
          slug: true,
          minPrice: true,
          maxPrice: true,
          variants: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              images: {
                orderBy: { position: 'asc' },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      });
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED', shop: { status: 'APPROVED' } },
      });
    });

    it('filter shopId/categoryId/khoảng giá khi có', async () => {
      await service.listPublicProducts({
        ...baseQuery,
        shopId: 'shop-1',
        categoryId: 'cat-1',
        minPrice: 100000,
        maxPrice: 300000,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PUBLISHED',
            shop: { status: 'APPROVED' },
            shopId: 'shop-1',
            categoryId: 'cat-1',
            maxPrice: { gte: 100000 },
            minPrice: { lte: 300000 },
          },
        }),
      );
    });

    it('mỗi giá trị attributeValues là 1 điều kiện AND độc lập', async () => {
      await service.listPublicProducts({
        ...baseQuery,
        attributeValues: ['Đỏ', 'M'],
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PUBLISHED',
            shop: { status: 'APPROVED' },
            AND: [
              {
                variants: {
                  some: {
                    isActive: true,
                    attributeValues: {
                      some: { attributeValue: { value: 'Đỏ' } },
                    },
                  },
                },
              },
              {
                variants: {
                  some: {
                    isActive: true,
                    attributeValues: {
                      some: { attributeValue: { value: 'M' } },
                    },
                  },
                },
              },
            ],
          },
        }),
      );
    });

    it('sort price-asc/price-desc dùng minPrice, page/limit tính đúng skip', async () => {
      await service.listPublicProducts({
        ...baseQuery,
        sort: 'price-asc',
        page: 3,
        limit: 20,
      });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { minPrice: 'asc' },
          skip: 40,
          take: 20,
        }),
      );

      await service.listPublicProducts({ ...baseQuery, sort: 'price-desc' });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { minPrice: 'desc' } }),
      );
    });

    it('map đúng imageUrl từ variant active đầu tiên, trả total/page/limit', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          categoryId: 'cat-1',
          name: 'Áo thun',
          slug: 'ao-thun',
          minPrice: '100000',
          maxPrice: '150000',
          variants: [
            { images: [{ url: 'https://example.com/a.jpg', position: 0 }] },
          ],
        },
        {
          id: 'p2',
          categoryId: 'cat-1',
          name: 'Quần jean',
          slug: 'quan-jean',
          minPrice: '200000',
          maxPrice: '200000',
          variants: [],
        },
      ]);
      prisma.product.count.mockResolvedValue(2);

      const result = await service.listPublicProducts(baseQuery);

      expect(result.items[0].imageUrl).toBe('https://example.com/a.jpg');
      expect(result.items[1].imageUrl).toBeNull();
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(12);
    });

    // Week5.md Bước 1.6-1.9/2.4b/2.5 — search full-text theo q. Việc "có
    // dấu/không dấu ra cùng kết quả" là hành vi của unaccent() ở tầng
    // Postgres thật (đã verify bằng psql/curl thật ở Bước 2.4b/2.5, không
    // giả lập lại được bằng mock Prisma) — ở đây chỉ verify phần logic
    // service tự viết: q được truyền y nguyên (không tự accent-strip phía
    // service) vào $queryRaw, tập id khớp được AND vào where Prisma, và
    // JS tự sort lại theo rank khi cần (vì $queryRaw không có ORDER BY).
    describe('search (q)', () => {
      function mockRanked(rows: { id: string; rank: number }[]) {
        prisma.$queryRaw.mockResolvedValue(rows);
      }

      function cardRow(id: string, overrides: Record<string, unknown> = {}) {
        return {
          id,
          categoryId: 'cat-1',
          name: `Product ${id}`,
          slug: id,
          minPrice: '100000',
          maxPrice: '100000',
          variants: [],
          ...overrides,
        };
      }

      // $queryRaw gọi dạng tagged template — mock.calls[n] là [strings, ...
      // giá trị interpolate]. jest.Mock không tự có generic cho tagged
      // template nên .mock.calls vốn kiểu `any`; ép kiểu tường minh 1 lần ở
      // đây thay vì để `any` rò rỉ ra từng chỗ dùng (@typescript-eslint/
      // no-unsafe-assignment).
      function queryRawValues(callIndex: number): string[] {
        const calls = prisma.$queryRaw.mock.calls as unknown as Array<
          [TemplateStringsArray, ...string[]]
        >;
        const [, ...values] = calls[callIndex];
        return values;
      }

      it('q không dấu và có dấu đều truyền nguyên văn vào $queryRaw (DB tự unaccent, service không tự xử lý)', async () => {
        mockRanked([{ id: 'p1', rank: 1 }]);
        prisma.product.findMany.mockResolvedValue([cardRow('p1')]);

        await service.listPublicProducts({ ...baseQuery, q: 'ao thun' });
        expect(queryRawValues(0)).toEqual(['ao thun', 'ao thun']);

        await service.listPublicProducts({ ...baseQuery, q: 'áo thun' });
        expect(queryRawValues(1)).toEqual(['áo thun', 'áo thun']);
      });

      it('có q + sort mặc định "newest" -> xếp theo rank (JS sort), không gọi count', async () => {
        // Cố tình trả rank không theo thứ tự để verify service tự sort lại,
        // không dựa vào thứ tự $queryRaw trả về (SQL không có ORDER BY).
        mockRanked([
          { id: 'p1', rank: 0.2 },
          { id: 'p2', rank: 0.9 },
        ]);
        prisma.product.findMany.mockResolvedValue([
          cardRow('p1'),
          cardRow('p2'),
        ]);

        const result = await service.listPublicProducts({
          ...baseQuery,
          q: 'áo',
        });

        expect(result.items.map((item) => item.id)).toEqual(['p2', 'p1']);
        expect(prisma.product.count).not.toHaveBeenCalled();
        expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
        // Không skip/take/orderBy ở Prisma cho nhánh rank — tự sort/cắt
        // trang bằng JS. Đọc thẳng call args đã ép kiểu (tránh
        // expect.any()/objectContaining lồng nhau gây lỗi lint
        // no-unsafe-assignment khi so khớp với type cụ thể của findMany).
        const [[call]] = prisma.product.findMany.mock.calls as unknown as [
          [{ where: unknown; skip?: unknown; orderBy?: unknown }],
        ];
        expect(call.where).toEqual({
          status: 'PUBLISHED',
          shop: { status: 'APPROVED' },
          id: { in: ['p1', 'p2'] },
        });
        expect(call.skip).toBeUndefined();
        expect(call.orderBy).toBeUndefined();
      });

      it('kết hợp q với filter category/giá vẫn đúng (AND cả 2 điều kiện)', async () => {
        mockRanked([{ id: 'p1', rank: 1 }]);
        prisma.product.findMany.mockResolvedValue([cardRow('p1')]);

        await service.listPublicProducts({
          ...baseQuery,
          q: 'áo',
          categoryId: 'cat-1',
          minPrice: 100000,
          maxPrice: 300000,
        });

        expect(prisma.product.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              status: 'PUBLISHED',
              shop: { status: 'APPROVED' },
              categoryId: 'cat-1',
              maxPrice: { gte: 100000 },
              minPrice: { lte: 300000 },
              id: { in: ['p1'] },
            },
          }),
        );
      });

      it('q không khớp gì -> total 0, không gọi findMany/count', async () => {
        mockRanked([]);

        const result = await service.listPublicProducts({
          ...baseQuery,
          q: 'khong ton tai xyz',
        });

        expect(result).toEqual({ items: [], total: 0, page: 1, limit: 12 });
        expect(prisma.product.findMany).not.toHaveBeenCalled();
        expect(prisma.product.count).not.toHaveBeenCalled();
      });

      it('có q + user tự chọn sort price-asc -> giữ nguyên price-asc, không ép rank', async () => {
        mockRanked([
          { id: 'p1', rank: 0.9 },
          { id: 'p2', rank: 0.2 },
        ]);
        prisma.product.findMany.mockResolvedValue([
          cardRow('p1'),
          cardRow('p2'),
        ]);
        prisma.product.count.mockResolvedValue(2);

        await service.listPublicProducts({
          ...baseQuery,
          q: 'áo',
          sort: 'price-asc',
        });

        const expectedWhere = {
          status: 'PUBLISHED',
          shop: { status: 'APPROVED' },
          id: { in: ['p1', 'p2'] },
        };
        expect(prisma.product.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { minPrice: 'asc' },
            where: expectedWhere,
          }),
        );
        expect(prisma.product.count).toHaveBeenCalledWith({
          where: expectedWhere,
        });
      });
    });
  });

  describe('getCategories', () => {
    it('trả danh sách category, sort theo tên, không lộ field thừa', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Điện tử', slug: 'dien-tu', parentId: null },
        {
          id: 'cat-2',
          name: 'Điện thoại',
          slug: 'dien-thoai',
          parentId: 'cat-1',
        },
      ]);

      const result = await service.getCategories();

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true, slug: true, parentId: true },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([
        { id: 'cat-1', name: 'Điện tử', slug: 'dien-tu', parentId: null },
        {
          id: 'cat-2',
          name: 'Điện thoại',
          slug: 'dien-thoai',
          parentId: 'cat-1',
        },
      ]);
    });
  });
});
