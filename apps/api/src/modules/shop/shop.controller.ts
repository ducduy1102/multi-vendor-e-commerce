import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { EmailVerifiedGuard } from '../../shared/guards/email-verified.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { errorExample } from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { createShopSchema, type CreateShopDto } from './dto/create-shop.dto';
import {
  resubmitShopSchema,
  type ResubmitShopDto,
} from './dto/resubmit-shop.dto';
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
  statusChangedAt: '2026-01-01T00:00:00.000Z',
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
    summary:
      'Cập nhật thông tin shop — chỉ chủ sở hữu, không đổi slug/status; chỉ khi shop đang REJECTED hoặc APPROVED',
    description:
      'Shop PENDING (đang chờ duyệt) và SUSPENDED (đang bị khoá) bị khoá chỉnh sửa. Kiểm tra trạng thái và ghi là ' +
      'một câu UPDATE có điều kiện nên không có kẽ hở giữa các tab. Shop REJECTED muốn sửa rồi nộp lại trong một ' +
      'bước thì dùng POST /shops/{shopId}/resubmit.',
  })
  @ApiBody({ schema: { example: { name: 'Tên shop mới' } } })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { shop: SHOP_EXAMPLE } } },
  })
  @ApiResponse({ status: 403, description: 'Không phải chủ sở hữu shop' })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
  @ApiResponse({
    status: 409,
    description:
      'Shop đang ở trạng thái không cho sửa (PENDING/SUSPENDED) — details.status là trạng thái hiện tại',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Shop details cannot be edited while the shop is PENDING',
        code: 'SHOP_EDIT_NOT_ALLOWED',
        details: { status: 'PENDING' },
      },
    },
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateShopSchema)) dto: UpdateShopDto,
  ) {
    const shop = await this.shopService.updateShop(user.userId, id, dto);
    return { shop };
  }

  // Tham số route PHẢI tên `shopId`: ShopOwnerGuard đọc `params.shopId` (đặt `:id` guard sẽ hiểu là productId
  // và trả 404 sai). Là hành động nên trả 200 (không phải 201 mặc định của @Post).
  @Post(':shopId/resubmit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiParam({ name: 'shopId', description: 'ID shop' })
  @ApiOperation({
    summary:
      'Gửi duyệt lại shop bị từ chối (REJECTED → PENDING), có thể kèm chỉnh sửa — chỉ chủ sở hữu',
    description:
      'Body dùng chung schema với PATCH /shops/{id} (mọi field tuỳ chọn; {} = nộp lại không sửa gì; status/slug ' +
      'bị bỏ qua). Chuyển trạng thái trước rồi mới ghi field, tất cả trong một transaction: nếu shop không còn ' +
      'REJECTED thì không field nào bị sửa. Chủ shop không bao giờ tự đưa shop tới APPROVED.',
  })
  @ApiBody({
    schema: {
      example: { name: 'Tên shop đã chỉnh', description: 'Mô tả mới' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Shop sau khi nộp lại (status PENDING, statusReason null)',
    schema: { example: { success: true, data: { shop: SHOP_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (URL logo sai, tên chỉ toàn khoảng trắng...)',
    schema: { example: errorExample('logoUrl: shop.validationLogoUrlInvalid') },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không phải chủ sở hữu shop' })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại',
    schema: { example: errorExample('Shop not found') },
  })
  @ApiResponse({
    status: 409,
    description:
      'Shop không còn ở REJECTED (đã nộp lại / đã được xử lý) hoặc thua race với lần nộp lại khác',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Cannot change shop status from APPROVED to PENDING',
        code: 'SHOP_INVALID_TRANSITION',
      },
    },
  })
  async resubmit(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Body(new ZodValidationPipe(resubmitShopSchema)) dto: ResubmitShopDto,
  ) {
    const shop = await this.shopService.resubmitShop(user.userId, shopId, dto);
    return { shop };
  }
}
