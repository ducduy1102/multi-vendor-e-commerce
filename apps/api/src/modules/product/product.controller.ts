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

// Không có prefix chung ở @Controller() — route trải trên 3 nhóm path khác
// nhau (shops/:shopId/products, products/:id, uploads/signature), khai
// tường minh path đầy đủ ở từng method thay vì gộp 1 prefix giả.
@Controller()
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post('shops/:shopId/products')
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, ShopOwnerGuard)
  async create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
  ) {
    const product = await this.productService.createProduct(shopId, dto);
    return { product };
  }

  @Get('shops/:shopId/products')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  async listMine(@Param('shopId') shopId: string) {
    const products = await this.productService.getMyProducts(shopId);
    return { products };
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
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
  async archive(@Param('id') id: string) {
    const product = await this.productService.archiveProduct(id);
    return { product };
  }

  @Get('products')
  async listPublic(
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: ListProductsQueryDto,
  ) {
    return this.productService.listPublicProducts(query);
  }

  @Get('products/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async getOne(
    @Param('id') id: string,
    @CurrentUserOptional() user?: AuthenticatedUser,
  ) {
    const product = await this.productService.getProduct(id, user?.userId);
    return { product };
  }

  @Post('uploads/signature')
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  uploadSignature() {
    return this.cloudinaryService.generateUploadSignature({
      folder: 'multi-vendor-ecommerce',
    });
  }
}
