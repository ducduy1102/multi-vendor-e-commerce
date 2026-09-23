import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import { CurrentUserOptional } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { EmailVerifiedGuard } from '../../shared/guards/email-verified.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../shared/guards/optional-jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import {
  createProductSchema,
  type CreateProductDto,
} from './dto/create-product.dto';
import {
  listProductsQuerySchema,
  type ListProductsQueryDto,
} from './dto/list-products-query.dto';
import {
  updateProductSchema,
  type UpdateProductDto,
} from './dto/update-product.dto';
import { ProductService } from './product.service';

// DTO validate bằng Zod (không phải class), @nestjs/swagger không tự suy ra
// schema được nên khai @ApiBody/@ApiResponse bằng example thủ công (giống
// AuthController/ShopController).
const PRODUCT_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  shopId: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
  categoryId: 'd00315d7-c47b-4141-82ea-dcf585d8b762',
  name: 'Áo thun nam',
  slug: 'ao-thun-nam',
  description: null,
  status: 'DRAFT',
  minPrice: '150000',
  maxPrice: '150000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  attributes: [
    {
      id: 'e1a2b3c4-1234-4a5b-8c9d-abcdef111111',
      name: 'Màu sắc',
      position: 0,
      values: [{ id: 'f1a2b3c4-1234-4a5b-8c9d-abcdef222222', value: 'Đỏ' }],
    },
  ],
  variants: [
    {
      id: 'a1a2b3c4-1234-4a5b-8c9d-abcdef333333',
      sku: 'AT-DO-M',
      price: '150000',
      stock: 10,
      isActive: true,
      images: [],
      weightGram: null,
      attributeValues: [{ attributeName: 'Màu sắc', value: 'Đỏ' }],
    },
  ],
};

// Chỉ GET /products/:idOrSlug (chi tiết) trả thêm `shop` — create/update/
// archive dùng chung PRODUCT_EXAMPLE, không join bảng shops (Week5.md Bước
// 1.5/2.2), nên tách example riêng thay vì thêm field vào PRODUCT_EXAMPLE
// dùng chung.
const PRODUCT_DETAIL_EXAMPLE = {
  ...PRODUCT_EXAMPLE,
  shop: { name: 'ABC Shop', slug: 'abc-shop' },
};

const PRODUCT_LIST_ITEM_EXAMPLE = {
  id: PRODUCT_EXAMPLE.id,
  categoryId: PRODUCT_EXAMPLE.categoryId,
  name: PRODUCT_EXAMPLE.name,
  slug: PRODUCT_EXAMPLE.slug,
  status: PRODUCT_EXAMPLE.status,
  minPrice: PRODUCT_EXAMPLE.minPrice,
  maxPrice: PRODUCT_EXAMPLE.maxPrice,
  createdAt: PRODUCT_EXAMPLE.createdAt,
  updatedAt: PRODUCT_EXAMPLE.updatedAt,
  variants: [
    {
      id: PRODUCT_EXAMPLE.variants[0].id,
      sku: PRODUCT_EXAMPLE.variants[0].sku,
      price: PRODUCT_EXAMPLE.variants[0].price,
      stock: PRODUCT_EXAMPLE.variants[0].stock,
      isActive: true,
      images: [],
    },
  ],
};

const PRODUCT_CARD_EXAMPLE = {
  id: PRODUCT_EXAMPLE.id,
  categoryId: PRODUCT_EXAMPLE.categoryId,
  name: PRODUCT_EXAMPLE.name,
  slug: PRODUCT_EXAMPLE.slug,
  minPrice: PRODUCT_EXAMPLE.minPrice,
  maxPrice: PRODUCT_EXAMPLE.maxPrice,
  imageUrl: null,
};

const CATEGORY_EXAMPLE = {
  id: PRODUCT_EXAMPLE.categoryId,
  name: 'Điện thoại',
  slug: 'dien-thoai',
  parentId: null,
};

const UPLOAD_SIGNATURE_EXAMPLE = {
  signature: '12e56f42a1b2c3d4e5f6...',
  timestamp: 1_789_473_380,
  apiKey: '733712345678901',
  cloudName: 'ducduydev',
};

// Không có prefix chung ở @Controller() — route trải trên 3 nhóm path khác
// nhau (shops/:shopId/products, products/:id, uploads/signature), khai
// tường minh path đầy đủ ở từng method thay vì gộp 1 prefix giả.
@ApiTags('product')
@Controller()
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post('shops/:shopId/products')
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Tạo product kèm variant matrix cho shop — cần email đã xác thực + đúng chủ shop',
  })
  @ApiBody({
    schema: {
      example: {
        name: 'Áo thun nam',
        categoryId: PRODUCT_EXAMPLE.categoryId,
        attributes: [{ name: 'Màu sắc', values: ['Đỏ', 'Xanh'] }],
        variants: [
          {
            sku: 'AT-DO-M',
            price: 150000,
            stock: 10,
            attributeValues: ['Đỏ'],
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo product thành công, status luôn DRAFT',
    schema: { example: { success: true, data: { product: PRODUCT_EXAMPLE } } },
  })
  @ApiResponse({
    status: 403,
    description: 'Email chưa xác thực, hoặc không phải chủ shop',
  })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
  async create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
  ) {
    const product = await this.productService.createProduct(shopId, dto);
    return { product };
  }

  @Get('shops/:shopId/products')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Danh sách product của shop mình — mọi status, kể cả DRAFT/ARCHIVED',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { products: [PRODUCT_LIST_ITEM_EXAMPLE] },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  async listMine(@Param('shopId') shopId: string) {
    const products = await this.productService.getMyProducts(shopId);
    return { products };
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Cập nhật product — chỉ chủ shop. attributes/variants phải gửi cùng nhau (reconcile) hoặc cùng bỏ trống',
  })
  @ApiBody({
    schema: { example: { name: 'Tên product mới', status: 'PUBLISHED' } },
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { product: PRODUCT_EXAMPLE } } },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({ status: 404, description: 'Product không tồn tại' })
  async update(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
  ) {
    const product = await this.productService.updateProduct(shopId, id, dto);
    return { product };
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Archive product (status=ARCHIVED) — không xoá cứng, chỉ chủ shop',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { product: { ...PRODUCT_EXAMPLE, status: 'ARCHIVED' } },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({ status: 404, description: 'Product không tồn tại' })
  async archive(@Param('id') id: string) {
    const product = await this.productService.archiveProduct(id);
    return { product };
  }

  @Get('categories')
  @ApiOperation({
    summary:
      'Danh sách category (chỉ đọc — chưa có CRUD, Admin category management để dành Tuần 11)',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { categories: [CATEGORY_EXAMPLE] } },
    },
  })
  async listCategories() {
    const categories = await this.productService.getCategories();
    return { categories };
  }

  @Get('products')
  @ApiOperation({
    summary:
      'Danh sách product public (trang chủ + trang danh sách) — luôn PUBLISHED + shop APPROVED',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 12 })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['newest', 'price-asc', 'price-desc'],
  })
  @ApiQuery({ name: 'shopId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'minPrice', required: false, example: 100000 })
  @ApiQuery({ name: 'maxPrice', required: false, example: 300000 })
  @ApiQuery({
    name: 'attributeValues',
    required: false,
    description:
      'Lặp lại param cho nhiều giá trị, vd ?attributeValues=Đỏ&attributeValues=M',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'Search full-text theo name+description (Postgres tsvector, không phân biệt dấu). Có q + sort mặc định (newest) sẽ tự đổi sang xếp theo độ liên quan, trừ khi tự chọn price-asc/price-desc',
    example: 'áo thun',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { items: [PRODUCT_CARD_EXAMPLE], total: 1, page: 1, limit: 12 },
      },
    },
  })
  async listPublic(
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: ListProductsQueryDto,
  ) {
    return this.productService.listPublicProducts(query);
  }

  @Get('products/:idOrSlug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Chi tiết 1 product theo id HOẶC slug — public (PUBLISHED+APPROVED) hoặc chủ shop xem mọi status. ' +
      'Nhận cả 2 kiểu (không chỉ slug) vì trang seller sửa sản phẩm (FE modules/product) gọi lại đúng ' +
      'endpoint này theo id thật, trang chi tiết public gọi theo slug (Week5.md Bước 1.4).',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { product: PRODUCT_DETAIL_EXAMPLE } },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Không tồn tại, hoặc chưa PUBLISHED/shop chưa APPROVED (ẩn với guest)',
  })
  async getOne(
    @Param('idOrSlug') idOrSlug: string,
    @CurrentUserOptional() user?: AuthenticatedUser,
  ) {
    const product = await this.productService.getProduct(
      idOrSlug,
      user?.userId,
    );
    return { product };
  }

  @Post('uploads/signature')
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Lấy chữ ký signed upload Cloudinary — FE tự upload thẳng lên Cloudinary bằng chữ ký này, không qua BE',
  })
  @ApiResponse({
    // @Post() không khai @HttpCode() tường minh -> NestJS mặc định 201, đã
    // verify thật bằng curl ở Week4.md Bước 2.15 (không phải 200 dù chỉ ký,
    // không thực sự "tạo" resource nào ở BE).
    status: 201,
    schema: { example: { success: true, data: UPLOAD_SIGNATURE_EXAMPLE } },
  })
  @ApiResponse({ status: 403, description: 'Email chưa xác thực' })
  uploadSignature() {
    return this.cloudinaryService.generateUploadSignature({
      folder: 'multi-vendor-ecommerce',
    });
  }
}
