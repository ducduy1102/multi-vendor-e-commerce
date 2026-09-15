import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { slugify } from '../../shared/utils/slugify';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';

// Đủ thử slug, slug-2 .. slug-20 trước khi coi là bế tắc — cùng ngưỡng đã
// dùng ở ShopService.createShop. Product không có slug do người dùng tự
// nhập (khác Shop) nên không cần nhánh "explicit slug", chỉ có 1 chiến lược.
const MAX_GENERATED_SLUG_ATTEMPTS = 20;

const productWithRelationsSelect = {
  id: true,
  shopId: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  minPrice: true,
  maxPrice: true,
  createdAt: true,
  updatedAt: true,
  attributes: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      position: true,
      values: { select: { id: true, value: true } },
    },
  },
  variants: {
    select: {
      id: true,
      sku: true,
      price: true,
      stock: true,
      isActive: true,
      imageUrl: true,
      weightGram: true,
      attributeValues: {
        select: {
          attributeValue: {
            select: {
              value: true,
              attribute: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductWithRelations = Prisma.ProductGetPayload<{
  select: typeof productWithRelationsSelect;
}>;

// Chỉ dùng nội bộ cho getProduct để quyết định quyền xem (không lộ ra
// response — shop bị strip trước khi map, xem getProduct) — không gộp vào
// productWithRelationsSelect vì createProduct/updateProduct/archiveProduct
// không cần join thêm bảng shops.
const productDetailSelect = {
  ...productWithRelationsSelect,
  shop: { select: { ownerId: true, status: true } },
} satisfies Prisma.ProductSelect;

// Danh sách seller (GET /shops/:shopId/products) không cần join
// attributeValue->attribute — chỉ đủ field cho 1 dòng danh sách (rules/
// backend.md mục 4, nhấn mạnh riêng cho list product/order).
const productListItemSelect = {
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
} satisfies Prisma.ProductSelect;

export type ProductListItemSummary = Prisma.ProductGetPayload<{
  select: typeof productListItemSelect;
}>;

// Card cho trang chủ/danh sách public (Bước 2.10) — không trả description/
// attributes/toàn bộ variant (rules/backend.md mục 4). imageUrl lấy từ 1
// variant active duy nhất (variant active đầu tiên tạo — không có khái
// niệm "ảnh đại diện" riêng ở Product, chỉ ProductVariant.imageUrl).
const productCardSelect = {
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
} satisfies Prisma.ProductSelect;

type ProductCardRow = Prisma.ProductGetPayload<{
  select: typeof productCardSelect;
}>;

export interface ProductCardSummary {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  minPrice: Prisma.Decimal;
  maxPrice: Prisma.Decimal;
  imageUrl: string | null;
}

export interface PaginatedProductCards {
  items: ProductCardSummary[];
  total: number;
  page: number;
  limit: number;
}

// Không trả nguyên bảng nối VariantAttributeValue/ProductAttributeValue ra
// ngoài — flatten thành cặp tên thuộc tính + giá trị đã resolve sẵn, khớp
// đúng shape productSchema ở packages/types.
export type ProductSummary = Omit<ProductWithRelations, 'variants'> & {
  variants: (Omit<
    ProductWithRelations['variants'][number],
    'attributeValues'
  > & {
    attributeValues: { attributeName: string; value: string }[];
  })[];
};

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  // shopId đã được ShopOwnerGuard xác nhận đúng chủ trước khi vào đây — không
  // check lại ownership trong service (tránh double-check dư thừa, cùng lý do
  // đã ghi ở Week3.md Bước 2.6/Week4.md Bước 1.5).
  async createProduct(
    shopId: string,
    dto: CreateProductDto,
  ): Promise<ProductSummary> {
    const baseSlug = slugify(dto.name);

    for (let attempt = 0; attempt < MAX_GENERATED_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const taken = await this.prisma.product.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (taken) {
        continue;
      }

      try {
        return await this.prisma.$transaction((tx) =>
          this.createProductInTransaction(tx, shopId, slug, dto),
        );
      } catch (error) {
        // Race: 2 request generate cùng slug gần như đồng thời, cả 2 đều pass
        // check "taken" ở trên trước khi 1 trong 2 commit trước — không tin
        // riêng bước check, thử hậu tố kế tiếp thay vì để lỗi 500 lộ ra
        // ngoài. Transaction đã rollback hết (Product/attribute/variant vừa
        // tạo), an toàn để thử lại từ đầu với slug khác.
        if (this.isSlugConflict(error)) {
          continue;
        }
        // Bug thật phát hiện qua test tay bằng DB thật: transaction này còn
        // tạo ProductVariant (có @@unique([shopId, sku]) riêng, Bước 1.7) —
        // P2002 do trùng SKU cũng là Prisma.PrismaClientKnownRequestError,
        // nếu không phân biệt theo error.meta.modelName sẽ bị hiểu lầm
        // thành "trùng slug" và tự thử lại slug khác vô nghĩa tới hết lượt,
        // báo sai nguyên nhân ("Slug already exists" thay vì SKU trùng).
        if (this.isVariantSkuConflict(error)) {
          throw new ConflictException('SKU already exists in this shop');
        }
        throw error;
      }
    }

    throw new ConflictException('Slug already exists');
  }

  private async createProductInTransaction(
    tx: Prisma.TransactionClient,
    shopId: string,
    slug: string,
    dto: CreateProductDto,
  ): Promise<ProductSummary> {
    const { minPrice, maxPrice } = this.computePriceRange(dto.variants);
    const product = await tx.product.create({
      data: {
        shopId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        description: dto.description,
        minPrice,
        maxPrice,
        // status không set tường minh — để Prisma tự áp default DRAFT
        // (đúng quyết định Week4.md Bước 1.4/2.5: tạo xong luôn là nháp,
        // "Đăng bán" là action riêng qua updateProduct).
      },
      select: { id: true },
    });

    // attributeValueIdsByPosition[i] = Map<giá trị string, id> cho
    // attributes[i] cùng vị trí — attributeValues[] của mỗi variant tham
    // chiếu THEO VỊ TRÍ (không tra theo tên), đúng bất biến Zod
    // (createProductSchema) đã validate trước khi tới đây.
    const attributeValueIdsByPosition: Map<string, string>[] = [];
    for (let position = 0; position < dto.attributes.length; position++) {
      const attribute = dto.attributes[position];
      const createdAttribute = await tx.productAttribute.create({
        data: { productId: product.id, name: attribute.name, position },
        select: { id: true },
      });

      const valueIdByValue = new Map<string, string>();
      for (const value of attribute.values) {
        const createdValue = await tx.productAttributeValue.create({
          data: { attributeId: createdAttribute.id, value },
          select: { id: true },
        });
        valueIdByValue.set(value, createdValue.id);
      }
      attributeValueIdsByPosition.push(valueIdByValue);
    }

    for (const variant of dto.variants) {
      const createdVariant = await tx.productVariant.create({
        data: {
          productId: product.id,
          // Denormalized ownership reference (Week4.md Bước 1.7) — gán bằng
          // shopId đã xác nhận qua ShopOwnerGuard, KHÔNG có field này trong
          // CreateProductDto nên không có gì để "quên lọc" từ payload FE.
          shopId,
          sku: variant.sku,
          price: variant.price,
          stock: variant.stock,
          imageUrl: variant.imageUrl,
        },
        select: { id: true },
      });

      const attributeValueIds = this.resolveAttributeValueIds(
        variant.attributeValues,
        attributeValueIdsByPosition,
      );

      if (attributeValueIds.length > 0) {
        await tx.variantAttributeValue.createMany({
          data: attributeValueIds.map((attributeValueId) => ({
            variantId: createdVariant.id,
            attributeValueId,
          })),
        });
      }
    }

    return this.loadProductSummary(tx, product.id);
  }

  // shopId/productId đã qua ShopOwnerGuard xác nhận đúng chủ (route phẳng
  // PATCH /products/:id, tự tra shopId theo productId) — không check lại
  // ownership ở đây. Không cho sửa slug (Product không có slug do người
  // dùng tự nhập, xem createProduct) — chỉ field cơ bản + toàn bộ
  // attributes/variants (reconcile, không phải replace cứng — xem
  // reconcileAttributesAndVariants).
  async updateProduct(
    shopId: string,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductSummary> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productId },
          data: {
            name: dto.name,
            categoryId: dto.categoryId,
            description: dto.description,
            status: dto.status,
          },
        });

        if (dto.attributes && dto.variants) {
          await this.reconcileAttributesAndVariants(
            tx,
            shopId,
            productId,
            dto.attributes,
            dto.variants,
          );
        }

        return this.loadProductSummary(tx, productId);
      });
    } catch (error) {
      // Bug thật phát hiện qua test tay DB thật (cùng loại đã sửa ở
      // createProduct): thêm/đổi sku trùng với 1 variant khác trong shop —
      // không bắt riêng thì lộ nguyên PrismaClientKnownRequestError ra
      // ngoài (500 thô) thay vì 409 rõ nghĩa.
      if (this.isVariantSkuConflict(error)) {
        throw new ConflictException('SKU already exists in this shop');
      }
      throw error;
    }
  }

  // "Xoá" Product = update status = ARCHIVED, không prisma.delete (đúng
  // Bước 1.9 — OrderItem/CartItem cũ tham chiếu variant của product này vẫn
  // phải hợp lệ). productId đã qua ShopOwnerGuard xác nhận đúng chủ trước
  // khi vào đây, không phải load lại product chỉ để check tồn tại.
  async archiveProduct(productId: string): Promise<ProductSummary> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });
    return this.loadProductSummary(this.prisma, productId);
  }

  // Route GET /products/:id là PUBLIC (không JwtAuthGuard bắt buộc, guest
  // xem được) — viewerUserId chỉ có giá trị nếu request có cookie hợp lệ
  // (optional-auth, wiring guard cụ thể để dành Bước 2.12). Không phải chủ
  // shop mà product.status !== PUBLISHED hoặc shop.status !== APPROVED thì
  // 404 y hệt "không tồn tại" — KHÔNG lộ sản phẩm nháp/shop chưa duyệt qua
  // URL trực tiếp (đúng Bước 2.9 + rules/backend.md mục 6). Là chủ shop thì
  // xem được mọi status (dùng lại đúng endpoint này cho trang seller xem
  // lại/sửa, không tách route riêng).
  async getProduct(
    productId: string,
    viewerUserId?: string,
  ): Promise<ProductSummary> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: productDetailSelect,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const isOwner = product.shop.ownerId === viewerUserId;
    const isVisibleToPublic =
      product.status === 'PUBLISHED' && product.shop.status === 'APPROVED';
    if (!isOwner && !isVisibleToPublic) {
      throw new NotFoundException('Product not found');
    }

    // Bug thật phát hiện qua test tay bằng curl thật (Bước 2.15): trước đây
    // truyền thẳng `product` (có thêm field `shop` từ productDetailSelect)
    // vào mapProduct() — TypeScript không báo lỗi vì đây không phải object
    // literal (chỉ excess-property-check literal, không áp dụng cho biến),
    // nhưng RUNTIME thì `{...product}` copy nguyên `shop.ownerId` ra ngoài
    // response — lộ cho cả guest chưa đăng nhập. Phải destructure bỏ `shop`
    // tường minh trước khi map, không dựa vào type hẹp hơn để "ẩn" field.
    const { shop, ...productWithoutShop } = product;
    return this.mapProduct(productWithoutShop);
  }

  // Query chính cho CẢ trang chủ lẫn trang danh sách public (Week4.md Bước
  // 1.12 — không tách endpoint /products/featured riêng). Luôn bắt buộc
  // status=PUBLISHED + shop.status=APPROVED (đúng Tuần 3 Bước 1.7 + Bước
  // 2.9) — không phải optional, đây là nơi duy nhất enforce policy này cho
  // listing (getProduct enforce riêng cho chi tiết 1 sản phẩm).
  async listPublicProducts(
    query: ListProductsQueryDto,
  ): Promise<PaginatedProductCards> {
    const where: Prisma.ProductWhereInput = {
      status: 'PUBLISHED',
      shop: { status: 'APPROVED' },
    };
    if (query.shopId) {
      where.shopId = query.shopId;
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    // So khoảng giá (product.minPrice/maxPrice) chồng lấp khoảng filter —
    // xấp xỉ chuẩn của ngành (Shopee/Lazada cũng lọc theo range tổng hợp,
    // không tra từng variant riêng) vì giá filter theo sản phẩm chứ không
    // theo variant cụ thể.
    if (query.minPrice !== undefined) {
      where.maxPrice = { gte: query.minPrice };
    }
    if (query.maxPrice !== undefined) {
      where.minPrice = { lte: query.maxPrice };
    }
    // Mỗi giá trị lọc độc lập ("có variant active mang giá trị này") — AND
    // giữa các giá trị khác nhau, không cần cùng 1 variant (đúng
    // packages/types/src/product.ts, xem comment ở listProductsQuerySchema).
    if (query.attributeValues && query.attributeValues.length > 0) {
      where.AND = query.attributeValues.map((value) => ({
        variants: {
          some: {
            isActive: true,
            attributeValues: { some: { attributeValue: { value } } },
          },
        },
      }));
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'price-asc'
        ? { minPrice: 'asc' }
        : query.sort === 'price-desc'
          ? { minPrice: 'desc' }
          : { createdAt: 'desc' };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: productCardSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.mapProductCard(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private mapProductCard(row: ProductCardRow): ProductCardSummary {
    const { variants, ...rest } = row;
    return { ...rest, imageUrl: variants[0]?.imageUrl ?? null };
  }

  // shopId đã qua ShopOwnerGuard xác nhận đúng chủ (route lồng
  // GET /shops/:shopId/products). Trả MỌI status (kể cả DRAFT/ARCHIVED) —
  // khác listPublicProducts (Bước 2.10), đây là trang quản lý của chính
  // seller, không phải view public.
  async getMyProducts(shopId: string): Promise<ProductListItemSummary[]> {
    return this.prisma.product.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      select: productListItemSelect,
    });
  }

  private async loadProductSummary(
    client: Prisma.TransactionClient | PrismaService,
    productId: string,
  ): Promise<ProductSummary> {
    const product = await client.product.findUniqueOrThrow({
      where: { id: productId },
      select: productWithRelationsSelect,
    });
    return this.mapProduct(product);
  }

  // Không hard-delete ProductAttribute/ProductAttributeValue đã tồn tại —
  // reconcile theo (productId, name)/(attributeId, value): đã có thì reuse
  // đúng id (giữ nguyên metadata cho variant đã soft-delete còn trỏ tới),
  // chưa có thì tạo mới. Attribute/value không còn trong payload KHÔNG bị
  // xoá (chỉ trở thành "không dùng nữa", dọn dẹp riêng nếu cần sau này) —
  // xem updateProduct-reconcile-decision.md mục 4 (đã xác nhận với người
  // dùng trước khi code).
  private async reconcileAttributesAndVariants(
    tx: Prisma.TransactionClient,
    shopId: string,
    productId: string,
    attributes: UpdateProductDto['attributes'] & object,
    variants: UpdateProductDto['variants'] & object,
  ): Promise<void> {
    const attributeValueIdsByPosition: Map<string, string>[] = [];
    for (let position = 0; position < attributes.length; position++) {
      const attribute = attributes[position];
      const existingAttribute = await tx.productAttribute.findFirst({
        where: { productId, name: attribute.name },
        select: { id: true },
      });

      const attributeId = existingAttribute
        ? existingAttribute.id
        : (
            await tx.productAttribute.create({
              data: { productId, name: attribute.name, position },
              select: { id: true },
            })
          ).id;

      if (existingAttribute) {
        await tx.productAttribute.update({
          where: { id: attributeId },
          data: { position },
        });
      }

      const valueIdByValue = new Map<string, string>();
      for (const value of attribute.values) {
        const existingValue = await tx.productAttributeValue.findFirst({
          where: { attributeId, value },
          select: { id: true },
        });
        const valueId = existingValue
          ? existingValue.id
          : (
              await tx.productAttributeValue.create({
                data: { attributeId, value },
                select: { id: true },
              })
            ).id;
        valueIdByValue.set(value, valueId);
      }
      attributeValueIdsByPosition.push(valueIdByValue);
    }

    const existingVariants = await tx.productVariant.findMany({
      where: { productId },
      select: { id: true, sku: true },
    });
    const existingVariantBySku = new Map(
      existingVariants.map((variant) => [variant.sku, variant]),
    );
    const payloadSkus = new Set(variants.map((variant) => variant.sku));

    for (const variant of variants) {
      const attributeValueIds = this.resolveAttributeValueIds(
        variant.attributeValues,
        attributeValueIdsByPosition,
      );

      const existing = existingVariantBySku.get(variant.sku);
      const variantId = existing
        ? existing.id
        : (
            await tx.productVariant.create({
              data: {
                productId,
                shopId,
                sku: variant.sku,
                price: variant.price,
                stock: variant.stock,
                imageUrl: variant.imageUrl,
              },
              select: { id: true },
            })
          ).id;

      if (existing) {
        await tx.productVariant.update({
          where: { id: variantId },
          data: {
            price: variant.price,
            stock: variant.stock,
            imageUrl: variant.imageUrl,
            isActive: true,
          },
        });
      }

      // Xoá/tạo lại link (VariantAttributeValue) của riêng variant này —
      // KHÔNG đụng tới ProductAttributeValue mà link đó trỏ tới (dữ liệu
      // thật nằm ở đó, link chỉ là bảng nối vô nghĩa nếu tách riêng).
      await tx.variantAttributeValue.deleteMany({ where: { variantId } });
      if (attributeValueIds.length > 0) {
        await tx.variantAttributeValue.createMany({
          data: attributeValueIds.map((attributeValueId) => ({
            variantId,
            attributeValueId,
          })),
        });
      }
    }

    // Variant có trong DB nhưng không còn trong payload -> soft-delete,
    // giữ nguyên VariantAttributeValue hiện có (không đụng tới) để vẫn biết
    // nó từng là tổ hợp thuộc tính nào — đúng Bước 1.9.
    for (const existing of existingVariants) {
      if (!payloadSkus.has(existing.sku)) {
        await tx.productVariant.update({
          where: { id: existing.id },
          data: { isActive: false },
        });
      }
    }

    // Tập variant active sau reconcile == đúng `variants` (payload) — variant
    // cũ bị gỡ đã set isActive=false ở trên, không còn tính vào khoảng giá.
    const { minPrice, maxPrice } = this.computePriceRange(variants);
    await tx.product.update({
      where: { id: productId },
      data: { minPrice, maxPrice },
    });
  }

  // Denormalize minPrice/maxPrice lên Product từ tập variant ACTIVE hiện tại
  // (Week4.md Bước 2.10 — Prisma không orderBy/filter được theo _min/_max
  // của quan hệ 1-nhiều, cần cache sẵn để listPublicProducts sort/filter giá
  // native). Luôn có ít nhất 1 phần tử (createProductSchema/updateProductSchema
  // đều bắt buộc `variants.min(1)` khi có mặt), không cần xử lý mảng rỗng.
  private computePriceRange(variants: { price: number }[]): {
    minPrice: number;
    maxPrice: number;
  } {
    const prices = variants.map((variant) => variant.price);
    return { minPrice: Math.min(...prices), maxPrice: Math.max(...prices) };
  }

  // attributeValues[i] tham chiếu THEO VỊ TRÍ tới attributeValueIdsByPosition[i]
  // (không tra theo tên) — Zod superRefine (createProductSchema/
  // updateProductSchema) đã đảm bảo mọi value ở đây chắc chắn có trong map
  // tương ứng trước khi tới service, .get() không thể trả undefined ở nhánh
  // thực tế chạy tới, filter chỉ để thoả kiểu.
  private resolveAttributeValueIds(
    attributeValues: string[],
    attributeValueIdsByPosition: Map<string, string>[],
  ): string[] {
    return attributeValues
      .map((value, position) =>
        attributeValueIdsByPosition[position]?.get(value),
      )
      .filter((id): id is string => id !== undefined);
  }

  private mapProduct(product: ProductWithRelations): ProductSummary {
    return {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        attributeValues: variant.attributeValues.map((link) => ({
          attributeName: link.attributeValue.attribute.name,
          value: link.attributeValue.value,
        })),
      })),
    };
  }

  // KHÁC ShopService.isSlugConflict (Shop chỉ có 1 unique constraint ngoài
  // id nên không cần soi thêm) — transaction tạo Product ở đây còn tạo
  // ProductVariant, có @@unique([shopId, sku]) riêng (Bước 1.7). P2002 do
  // trùng SKU cũng là PrismaClientKnownRequestError, phải soi
  // error.meta.modelName để không hiểu lầm thành trùng slug (bug thật đã
  // phát hiện qua test tay DB thật — xem createProduct).
  private isSlugConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      error.meta?.modelName === 'Product'
    );
  }

  private isVariantSkuConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      error.meta?.modelName === 'ProductVariant'
    );
  }
}
