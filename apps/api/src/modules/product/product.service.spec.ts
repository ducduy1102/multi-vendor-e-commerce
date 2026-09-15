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
    { name: 'Màu sắc', values: ['Đỏ', 'Xanh'] },
    { name: 'Size', values: ['M', 'L'] },
  ],
  variants: [
    {
      sku: 'AT-DO-M',
      price: 150000,
      stock: 10,
      attributeValues: ['Đỏ', 'M'],
      imageUrl: undefined,
    },
    {
      sku: 'AT-DO-L',
      price: 150000,
      stock: 8,
      attributeValues: ['Đỏ', 'L'],
      imageUrl: undefined,
    },
  ],
};

describe('ProductService', () => {
  let service: ProductService;
  let prisma: {
    product: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    productAttribute: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    productAttributeValue: { create: jest.Mock; findFirst: jest.Mock };
    productVariant: {
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    variantAttributeValue: { createMany: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'product-1', ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
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
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
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
          imageUrl: null,
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
        imageUrl: undefined,
      },
      select: { id: true },
    });

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
          imageUrl: undefined,
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
          imageUrl: null,
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
          imageUrl: undefined,
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
          imageUrl: undefined,
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

    it('reconcile attribute/value: reuse nếu đã tồn tại, tạo mới nếu chưa có', async () => {
      prisma.productAttribute.findFirst.mockResolvedValueOnce({
        id: 'attr-existing-Màu sắc',
      });
      prisma.productAttributeValue.findFirst
        .mockResolvedValueOnce({ id: 'val-existing-Đỏ' }) // "Đỏ" đã tồn tại
        .mockResolvedValueOnce(null); // "Vàng" chưa có, tạo mới
      mockLoadedProduct();

      await service.updateProduct('shop-1', 'product-1', {
        attributes: [{ name: 'Màu sắc', values: ['Đỏ', 'Vàng'] }],
        variants: [
          {
            sku: 'X',
            price: 1,
            stock: 1,
            attributeValues: ['Đỏ'],
            imageUrl: undefined,
          },
        ],
      });

      // Attribute "Màu sắc" đã tồn tại -> reuse, chỉ update lại position.
      expect(prisma.productAttribute.create).not.toHaveBeenCalled();
      expect(prisma.productAttribute.update).toHaveBeenCalledWith({
        where: { id: 'attr-existing-Màu sắc' },
        data: { position: 0 },
      });

      // "Đỏ" đã tồn tại -> reuse, không tạo mới. "Vàng" chưa có -> tạo mới.
      expect(prisma.productAttributeValue.create).toHaveBeenCalledTimes(1);
      expect(prisma.productAttributeValue.create).toHaveBeenCalledWith({
        data: { attributeId: 'attr-existing-Màu sắc', value: 'Vàng' },
        select: { id: true },
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
            imageUrl: undefined,
          },
          {
            sku: 'NEW',
            price: 100000,
            stock: 1,
            attributeValues: [],
            imageUrl: undefined,
          },
        ],
      });

      // sku "KEEP" khớp variant có sẵn -> update, không tạo mới.
      expect(prisma.productVariant.create).toHaveBeenCalledTimes(1);
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-keep' },
        data: { price: 200000, stock: 3, imageUrl: undefined, isActive: true },
      });

      // sku "NEW" không khớp -> tạo mới với đúng shopId đã xác nhận qua guard.
      expect(prisma.productVariant.create).toHaveBeenCalledWith({
        data: {
          productId: 'product-1',
          shopId: 'shop-1',
          sku: 'NEW',
          price: 100000,
          stock: 1,
          imageUrl: undefined,
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
              imageUrl: undefined,
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
              imageUrl: true,
            },
          },
        },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getProduct', () => {
    function mockDetailRow(overrides: Record<string, unknown> = {}) {
      prisma.product.findUnique.mockResolvedValue({
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
        shop: { ownerId: 'owner-1', status: 'APPROVED' },
        ...overrides,
      });
    }

    it('404 nếu product không tồn tại', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.getProduct('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('guest/public xem được product PUBLISHED của shop APPROVED', async () => {
      mockDetailRow({ status: 'PUBLISHED' });

      const result = await service.getProduct('product-1');
      expect(result.id).toBe('product-1');
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
        shop: { ownerId: 'owner-1', status: 'PENDING' },
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
            select: { imageUrl: true },
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
          variants: [{ imageUrl: 'https://example.com/a.jpg' }],
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
  });
});
