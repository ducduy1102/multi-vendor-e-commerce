import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { availableStock } from '../../shared/utils/available-stock';
import { slugify } from '../../shared/utils/slugify';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';

// Đủ thử slug, slug-2 .. slug-20 trước khi coi là bế tắc — cùng ngưỡng đã
// dùng ở ShopService.createShop. Product không có slug do người dùng tự
// nhập (khác Shop) nên không cần nhánh "explicit slug", chỉ có 1 chiến lược.
const MAX_GENERATED_SLUG_ATTEMPTS = 20;

// Week5.md Bước 1.3/2.12 — dùng chung ở mọi nơi select ảnh/variant (đủ
// dùng cho cả chi tiết lẫn danh sách, tránh lặp lại đúng shape 3 lần trong
// file này). Sắp theo position để FE không cần tự sort lại.
const variantImagesSelect = {
  orderBy: { position: 'asc' },
  select: { url: true, position: true },
} satisfies Prisma.ProductVariant$imagesArgs;

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
  // reconcileAttributesAndVariants KHÔNG hard-delete ProductAttribute/
  // ProductAttributeValue không còn trong payload update (giữ orphan row
  // cho lịch sử variant đã soft-delete, xem note-db.md mục 5d) — nhưng
  // response ở đây chỉ nên trả giá trị ĐANG THỰC SỰ SỐNG (còn ≥1 variant
  // active tham chiếu), không phải mọi giá trị từng tồn tại. Thiếu `where`
  // này là bug thật đã gặp: seller đổi "X, L" thành "Đỏ, Vàng", lưu xong "X,
  // L" vẫn hiện lại ở cả form sửa lẫn trang chi tiết public vì response trả
  // nguyên mọi ProductAttributeValue của attribute, không lọc theo variant
  // active. Attribute không còn value nào active (seller đổi hết mọi giá
  // trị) cũng bị ẩn luôn cả attribute đó — tránh hiện 1 nhóm thuộc tính rỗng
  // không có lựa chọn nào.
  attributes: {
    where: {
      values: {
        some: { variantValues: { some: { variant: { isActive: true } } } },
      },
    },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      position: true,
      values: {
        where: {
          variantValues: { some: { variant: { isActive: true } } },
        },
        select: { id: true, value: true },
      },
    },
  },
  variants: {
    select: {
      id: true,
      sku: true,
      price: true,
      stock: true,
      reservedStock: true,
      isActive: true,
      images: variantImagesSelect,
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

// Chỉ dùng nội bộ cho getProduct — ownerId/status dùng để quyết định quyền
// xem, không lộ ra response; name/slug (Week5.md Bước 1.5 hướng a) thì có
// lộ ra, dưới dạng object `shop: {name, slug}` map riêng trong getProduct(),
// không đưa nguyên object `shop` này ra ngoài (xem comment ở getProduct).
// Không gộp vào productWithRelationsSelect vì createProduct/updateProduct/
// archiveProduct không cần join thêm bảng shops.
const productDetailSelect = {
  ...productWithRelationsSelect,
  shop: { select: { name: true, slug: true, ownerId: true, status: true } },
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
      reservedStock: true,
      isActive: true,
      images: variantImagesSelect,
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductListItemSummary = Prisma.ProductGetPayload<{
  select: typeof productListItemSelect;
}>;

// Card cho trang chủ/danh sách public (Bước 2.10) — không trả description/
// attributes/toàn bộ variant (rules/backend.md mục 4). imageUrl (số ít) lấy
// từ ảnh đầu tiên (position=0) của 1 variant active duy nhất — card chỉ cần
// 1 ảnh bìa, không cần cả bộ ảnh (Week5.md Bước 2.12).
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
    select: {
      images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductCardRow = Prisma.ProductGetPayload<{
  select: typeof productCardSelect;
}>;

// Category chưa có module/CRUD riêng (Admin category management để dành Tuần
// 11, Week4.md Bước 1.3) — chỉ đọc, đủ phục vụ shortcut category ở trang chủ
// (Bước 3.3) và dropdown filter category ở trang danh sách public (Bước 3.4).
const categorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

export type CategorySummary = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
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
//
// `stock` trong response = available (kho vật lý - đang giữ chỗ, Week7.md 1.3), field
// `reservedStock` chỉ có khi viewer là chủ shop (kho vật lý = stock + reservedStock).
export type ProductSummary = Omit<ProductWithRelations, 'variants'> & {
  variants: (Omit<
    ProductWithRelations['variants'][number],
    'attributeValues' | 'reservedStock'
  > & {
    reservedStock?: number;
    attributeValues: { attributeName: string; value: string }[];
  })[];
};

// Chỉ getProduct() (chi tiết public/chủ shop) trả thêm `shop` — createProduct/
// updateProduct/archiveProduct dùng productWithRelationsSelect, không join
// bảng shops nên không có field này (Week5.md Bước 1.5/2.2).
export type ProductDetailSummary = ProductSummary & {
  shop: { name: string; slug: string };
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

      // `value.id` (nếu FE lỡ gửi) bị bỏ qua có chủ đích — create luôn tạo
      // mới toàn bộ, không có state cũ nào để match/reconcile theo id.
      const valueIdByValue = new Map<string, string>();
      for (const value of attribute.values) {
        const createdValue = await tx.productAttributeValue.create({
          data: { attributeId: createdAttribute.id, value: value.value },
          select: { id: true },
        });
        valueIdByValue.set(value.value, createdValue.id);
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

      if (variant.images.length > 0) {
        await tx.productImage.createMany({
          data: variant.images.map((url, position) => ({
            variantId: createdVariant.id,
            url,
            position,
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

  // Route GET /products/:idOrSlug là PUBLIC (không JwtAuthGuard bắt buộc,
  // guest xem được) — viewerUserId chỉ có giá trị nếu request có cookie hợp
  // lệ (OptionalJwtAuthGuard). Không phải chủ shop mà product.status !==
  // PUBLISHED hoặc shop.status !== APPROVED thì 404 y hệt "không tồn tại" —
  // KHÔNG lộ sản phẩm nháp/shop chưa duyệt qua URL trực tiếp (đúng Bước 2.9
  // + rules/backend.md mục 6). Là chủ shop thì xem được mọi status (dùng
  // lại đúng endpoint này cho trang seller xem lại/sửa, không tách route
  // riêng).
  //
  // Lookup theo id HOẶC slug (Week5.md Bước 1.4 quay lại hướng a, sau khi
  // phát hiện bug thật: hướng b — lookup CHỈ theo slug — đã bịt luôn đường
  // FE seller fetch lại product của mình theo id thật lúc mở trang edit
  // (modules/product/services/product.service.ts FE, hàm getProduct(id),
  // dùng từ Tuần 4, gọi CHUNG endpoint này). Verify lúc chốt hướng b chỉ rà
  // soát call site phía BE (ProductController), bỏ sót call site phía FE
  // cùng tên hàm. findFirst + OR (không phải findUnique, vì Prisma không
  // cho where nhiều field unique cùng lúc kiểu OR trong findUnique) — public
  // detail page (Bước 3.1) truyền slug, trang seller edit truyền id, cùng 1
  // endpoint xử lý được cả 2.
  async getProduct(
    idOrSlug: string,
    viewerUserId?: string,
  ): Promise<ProductDetailSummary> {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
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

    // Bug thật phát hiện qua test tay bằng curl thật (Tuần 4 Bước 2.15):
    // trước đây truyền thẳng `product` (có thêm field `shop` từ
    // productDetailSelect) vào mapProduct() — TypeScript không báo lỗi vì
    // đây không phải object literal (chỉ excess-property-check literal,
    // không áp dụng cho biến), nhưng RUNTIME thì `{...product}` copy nguyên
    // `shop.ownerId`/`shop.status` ra ngoài response — lộ cho cả guest chưa
    // đăng nhập. Phải destructure bỏ `shop` tường minh trước khi map, không
    // dựa vào type hẹp hơn để "ẩn" field.
    //
    // Week5.md Bước 1.5/2.2: chỉ `name`/`slug` của shop mới lộ ra response
    // (destructure lấy đúng 2 field này từ `shop`, không đưa nguyên object
    // `shop` — vẫn giữ ownerId/status ở lại bên trong, không lặp lại đúng
    // bug cũ theo hướng ngược lại).
    const { shop, ...productWithoutShop } = product;
    return {
      // reservedStock lộ nhu cầu mua của sản phẩm — chỉ trả cho chủ shop.
      ...this.mapProduct(productWithoutShop, isOwner),
      shop: { name: shop.name, slug: shop.slug },
    };
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

    // Week5.md Bước 1.8/1.9/2.5 — search full-text theo `q` (name trọng số A
    // + description trọng số B, đã có sẵn trong cột search_vector qua
    // trigger Bước 2.4b). Prisma chưa hỗ trợ native query tsvector nên chỉ
    // dùng $queryRaw để xác định TẬP id khớp + rank — mọi filter khác
    // (status/shop/category/giá/attributeValues) vẫn chạy qua Prisma `where`
    // như cũ (AND với `id IN (...)`), không viết lại logic filter đó bằng
    // raw SQL (tránh 2 nguồn logic filter lệch nhau).
    let rankById: Map<string, number> | undefined;
    if (query.q) {
      const ranked = await this.prisma.$queryRaw<
        { id: string; rank: number }[]
      >`
        SELECT id, ts_rank(search_vector, plainto_tsquery('simple', unaccent(${query.q}))) AS rank
        FROM products
        WHERE search_vector @@ plainto_tsquery('simple', unaccent(${query.q}))
      `;
      if (ranked.length === 0) {
        return { items: [], total: 0, page: query.page, limit: query.limit };
      }
      rankById = new Map(ranked.map((row) => [row.id, row.rank]));
      where.id = { in: [...rankById.keys()] };
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'price-asc'
        ? { minPrice: 'asc' }
        : query.sort === 'price-desc'
          ? { minPrice: 'desc' }
          : { createdAt: 'desc' };

    // Có `q` và user KHÔNG tự chọn sort khác (vẫn 'newest' mặc định từ Zod)
    // -> xếp theo độ liên quan (ts_rank) thay vì mới nhất, đúng 1.8. Chọn
    // hẳn price-asc/price-desc thì vẫn tôn trọng lựa chọn đó.
    const useRankOrder = rankById !== undefined && query.sort === 'newest';

    if (useRankOrder) {
      // Prisma không orderBy được theo đúng thứ tự 1 mảng id tuỳ ý — lấy hết
      // row đã khớp mọi filter (không skip/take ở Prisma) rồi tự sắp/xén
      // trang theo rank ở tầng service. Chấp nhận được ở quy mô project hiện
      // tại (không tối ưu cho catalog cực lớn, giống nhiều đánh đổi đơn giản
      // hoá khác đã chọn xuyên suốt project).
      const rows = await this.prisma.product.findMany({
        where,
        select: productCardSelect,
      });
      const sorted = rows
        .slice()
        .sort(
          (a, b) => (rankById!.get(b.id) ?? 0) - (rankById!.get(a.id) ?? 0),
        );
      const total = sorted.length;
      const start = (query.page - 1) * query.limit;
      const page = sorted.slice(start, start + query.limit);

      return {
        items: page.map((row) => this.mapProductCard(row)),
        total,
        page: query.page,
        limit: query.limit,
      };
    }

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
    return { ...rest, imageUrl: variants[0]?.images[0]?.url ?? null };
  }

  // shopId đã qua ShopOwnerGuard xác nhận đúng chủ (route lồng
  // GET /shops/:shopId/products). Trả MỌI status (kể cả DRAFT/ARCHIVED) —
  // khác listPublicProducts (Bước 2.10), đây là trang quản lý của chính
  // seller, không phải view public.
  async getMyProducts(shopId: string): Promise<ProductListItemSummary[]> {
    const products = await this.prisma.product.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      select: productListItemSelect,
    });
    // `stock` = available, cùng nghĩa với mọi API khác; reservedStock đi kèm cho chủ shop.
    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        stock: availableStock(variant),
      })),
    }));
  }

  async getCategories(): Promise<CategorySummary[]> {
    return this.prisma.category.findMany({
      select: categorySelect,
      orderBy: { name: 'asc' },
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
    // Chỉ create/update/archive (đã qua ShopOwnerGuard) gọi tới đây — luôn là chủ shop.
    return this.mapProduct(product, true);
  }

  // Không hard-delete ProductAttribute/ProductAttributeValue đã tồn tại —
  // attribute/value không còn trong payload KHÔNG bị xoá (chỉ trở thành
  // "không dùng nữa", giữ nguyên metadata cho variant đã soft-delete còn trỏ
  // tới) — xem note-db.md mục 5d (đã xác nhận với người dùng trước khi code).
  //
  // Reconcile theo `id` (không phải theo name/value text) — đúng cách
  // Shopify productOptionUpdate làm (rename giữ nguyên id, không đụng
  // variant). Có `id` VÀ resolve được (đúng scope productId/attributeId) ->
  // UPDATE tại chỗ (rename). Không có `id` hoặc `id` không resolve được ->
  // LUÔN tạo mới, KHÔNG fallback về match theo text — match theo text
  // (name/value) là nguyên nhân bug thật đã gặp: mỗi lần seller đổi tên
  // attribute/value (không phải xoá) bị hiểu nhầm thành "xoá cái cũ + tạo
  // cái mới", để lại row rác vĩnh viễn (đã verify thực tế: đổi tên 1
  // attribute 4 lần liên tiếp để lại 3 row `product_attributes` + 3 row
  // `product_attribute_values` chết, dù value text không hề đổi — vì value
  // bị nhân bản theo mỗi lần attributeId cha đổi).
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

      // Ternary tường minh (không gọi findFirst khi id vắng mặt) — Prisma bỏ
      // qua key `undefined` trong `where`, nếu gọi thẳng
      // findFirst({where:{id: attribute.id, productId}}) lúc attribute.id
      // là undefined sẽ vô tình thành findFirst({where:{productId}}) và
      // match nhầm attribute ĐẦU TIÊN của product. Scope thêm `productId`
      // để 1 attributeId của product khác không "chiếm" được attribute ở
      // đây qua request giả mạo.
      const existingAttribute = attribute.id
        ? await tx.productAttribute.findFirst({
            where: { id: attribute.id, productId },
            select: { id: true },
          })
        : null;

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
          data: { name: attribute.name, position },
        });
      }

      const valueIdByValue = new Map<string, string>();
      for (const value of attribute.values) {
        // Scope theo attributeId VỪA resolve ở trên (không phải id cũ trong
        // payload) — 1 valueId thuộc attribute khác (kể cả cùng product)
        // không được phép "chiếm" qua request giả mạo.
        const existingValue = value.id
          ? await tx.productAttributeValue.findFirst({
              where: { id: value.id, attributeId },
              select: { id: true },
            })
          : null;

        const valueId = existingValue
          ? existingValue.id
          : (
              await tx.productAttributeValue.create({
                data: { attributeId, value: value.value },
                select: { id: true },
              })
            ).id;

        if (existingValue) {
          await tx.productAttributeValue.update({
            where: { id: valueId },
            data: { value: value.value },
          });
        }

        // Vẫn key theo TEXT (không phải id) — resolveAttributeValueIds()
        // tra theo variant.attributeValues[i] (text), map này được rebuild
        // mới mỗi lần reconcile dùng đúng text vừa ghi (có thể vừa rename),
        // nên vẫn khớp đúng dù value vừa đổi tên — không cần đổi gì ở tầng
        // variant.
        valueIdByValue.set(value.value, valueId);
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
              },
              select: { id: true },
            })
          ).id;

      if (existing) {
        // Seller chỉ ghi KHO VẬT LÝ; số đang giữ chỗ do đơn hàng quản lý. Điều kiện
        // `reservedStock <= stock mới` nằm ngay trong câu UPDATE (không đọc-rồi-ghi) nên
        // 1 đơn giữ chỗ chen vào giữa chừng cũng không làm vỡ bất biến (CHECK ở DB).
        const { count } = await tx.productVariant.updateMany({
          where: { id: variantId, reservedStock: { lte: variant.stock } },
          data: {
            price: variant.price,
            stock: variant.stock,
            isActive: true,
          },
        });
        if (count === 0) {
          const current = await tx.productVariant.findUnique({
            where: { id: variantId },
            select: { reservedStock: true },
          });
          throw new ConflictException(
            `Stock of SKU ${variant.sku} cannot be lower than the quantity reserved by pending orders (${current?.reservedStock ?? 0})`,
          );
        }
        // Variant đã có sẵn — reconcile ảnh theo url (Week5.md Bước 2.12).
        await this.reconcileVariantImages(tx, variantId, variant.images);
      } else if (variant.images.length > 0) {
        // Variant mới tạo, chắc chắn chưa có ảnh nào — tạo thẳng, không cần
        // fetch/diff như reconcileVariantImages.
        await tx.productImage.createMany({
          data: variant.images.map((url, position) => ({
            variantId,
            url,
            position,
          })),
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

  // Reconcile ảnh của 1 variant theo khoá tự nhiên (url) — KHÁC soft-delete
  // của variant (mục trên): ảnh không có FK nào khác tham chiếu tới, không
  // cần giữ lịch sử, nên ảnh không còn trong payload bị xoá hẳn (Week5.md
  // Bước 1.3/2.12). Ảnh còn trong payload giữ nguyên id (chỉ update lại
  // position nếu thứ tự đổi), ảnh mới thì tạo.
  private async reconcileVariantImages(
    tx: Prisma.TransactionClient,
    variantId: string,
    urls: string[],
  ): Promise<void> {
    const existingImages = await tx.productImage.findMany({
      where: { variantId },
      select: { id: true, url: true, position: true },
    });
    const existingByUrl = new Map(
      existingImages.map((image) => [image.url, image]),
    );
    const payloadUrls = new Set(urls);

    for (let position = 0; position < urls.length; position++) {
      const url = urls[position];
      const existingImage = existingByUrl.get(url);
      if (!existingImage) {
        await tx.productImage.create({ data: { variantId, url, position } });
      } else if (existingImage.position !== position) {
        await tx.productImage.update({
          where: { id: existingImage.id },
          data: { position },
        });
      }
    }

    const staleImageIds = existingImages
      .filter((image) => !payloadUrls.has(image.url))
      .map((image) => image.id);
    if (staleImageIds.length > 0) {
      await tx.productImage.deleteMany({
        where: { id: { in: staleImageIds } },
      });
    }
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

  // includeReserved=false phải loại reservedStock TƯỜNG MINH khỏi response (destructure) —
  // type hẹp hơn không tự xoá field lúc runtime (rules/backend.md mục 4).
  private mapProduct(
    product: ProductWithRelations,
    includeReserved: boolean,
  ): ProductSummary {
    return {
      ...product,
      variants: product.variants.map((variant) => {
        const { reservedStock, attributeValues, ...rest } = variant;
        return {
          ...rest,
          stock: availableStock(variant),
          ...(includeReserved ? { reservedStock } : {}),
          attributeValues: attributeValues.map((link) => ({
            attributeName: link.attributeValue.attribute.name,
            value: link.attributeValue.value,
          })),
        };
      }),
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
