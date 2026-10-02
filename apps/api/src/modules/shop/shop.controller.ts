import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { EmailVerifiedGuard } from '../../shared/guards/email-verified.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { createShopSchema, type CreateShopDto } from './dto/create-shop.dto';
import { updateShopSchema, type UpdateShopDto } from './dto/update-shop.dto';
import { ShopService } from './shop.service';

// DTO validate bằng Zod (không phải class), @nestjs/swagger không tự suy ra
// schema từ class được nên khai @ApiBody bằng example thủ công (giống
// AuthController). "access_token" khớp ACCESS_TOKEN_COOKIE ở
// modules/auth/auth.constants.ts — chỉ dùng cho annotation Swagger nên viết
// literal thay vì import chéo module (rules/general.md mục 1).
const SHOP_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  ownerId: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

@ApiTags('shop')
@Controller('shops')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Post()
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Tạo shop mới — cần email đã xác thực' })
  @ApiBody({
    schema: { example: { name: 'Shop Thời Trang ABC' } },
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo shop thành công',
    schema: { example: { success: true, data: { shop: SHOP_EXAMPLE } } },
  })
  @ApiResponse({
    status: 403,
    description:
      'Email chưa xác thực (message: "EMAIL_NOT_VERIFIED", code: "EMAIL_NOT_VERIFIED")',
  })
  @ApiResponse({
    status: 409,
    description:
      'Đã sở hữu shop khác, hoặc slug đã tồn tại (2 message khác nhau)',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createShopSchema)) dto: CreateShopDto,
  ) {
    const shop = await this.shopService.createShop(user.userId, dto);
    return { shop };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Lấy shop của user hiện tại' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { shop: SHOP_EXAMPLE } } },
  })
  @ApiResponse({ status: 404, description: 'User chưa có shop' })
  async getMine(@CurrentUser() user: AuthenticatedUser) {
    const shop = await this.shopService.getMyShop(user.userId);
    return { shop };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Cập nhật thông tin shop — chỉ chủ sở hữu, không đổi slug/status',
  })
  @ApiBody({ schema: { example: { name: 'Tên shop mới' } } })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { shop: SHOP_EXAMPLE } } },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ sở hữu shop' })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateShopSchema)) dto: UpdateShopDto,
  ) {
    const shop = await this.shopService.updateShop(user.userId, id, dto);
    return { shop };
  }
}
