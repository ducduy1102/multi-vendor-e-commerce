import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { shopStatusSchema } from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  FORBIDDEN_ROLE_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { AdminService } from './admin.service';
import {
  adminShopListQuerySchema,
  type ListShopsQueryDto,
} from './dto/list-shops-query.dto';
import {
  adminUpdateShopStatusSchema,
  type UpdateShopStatusDto,
} from './dto/update-shop-status.dto';

// "access_token" khớp ACCESS_TOKEN_COOKIE ở modules/auth/auth.constants.ts — chỉ dùng cho annotation
// Swagger nên viết literal thay vì import chéo module (rules/general.md mục 1).
const ADMIN_SHOP_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  ownerId: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
};

// Khu quản trị toàn sàn — chỉ role ADMIN (Week8.md 1.8, lần đầu RolesGuard/@Roles gắn route thật).
// Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng.
@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải ADMIN',
  schema: { example: FORBIDDEN_ROLE_EXAMPLE },
})
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('shops')
  @ApiOperation({
    summary:
      'Danh sách shop theo trạng thái (mặc định hàng chờ duyệt PENDING), kèm chủ shop — chỉ ADMIN',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: shopStatusSchema.options,
    description: 'Mặc định PENDING',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { items: [ADMIN_SHOP_EXAMPLE], total: 1, page: 1, limit: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ, limit > 50...)',
    schema: {
      example: errorExample(
        "status: Invalid enum value. Expected 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED', received 'bad'",
      ),
    },
  })
  listShops(
    @Query(new ZodValidationPipe(adminShopListQuerySchema))
    query: ListShopsQueryDto,
  ) {
    return this.adminService.listShops(query);
  }

  @Patch('shops/:id/status')
  @ApiOperation({
    summary:
      'Duyệt / từ chối / khoá / mở khoá shop — chỉ các cạnh PENDING→APPROVED|REJECTED, APPROVED→SUSPENDED, SUSPENDED→APPROVED',
    description:
      'Từ chối (REJECTED) và khoá (SUSPENDED) bắt buộc có `reason`; duyệt và mở khoá xoá lý do cũ ' +
      '(`reason` gửi kèm bị bỏ qua). Khoá chỉ ngừng nhận ĐƠN MỚI và ẩn sản phẩm khỏi trang công khai — ' +
      'Seller vẫn đăng nhập và xử lý đơn đã có.',
  })
  @ApiParam({ name: 'id', description: 'ID shop' })
  @ApiBody({
    schema: {
      example: { status: 'SUSPENDED', reason: 'Vi phạm chính sách hàng cấm' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Shop sau khi đổi trạng thái (kèm statusReason)',
    schema: {
      example: {
        success: true,
        data: {
          shop: {
            ...ADMIN_SHOP_EXAMPLE,
            status: 'SUSPENDED',
            statusReason: 'Vi phạm chính sách hàng cấm',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (status không phải APPROVED/REJECTED/SUSPENDED, thiếu lý do khi từ chối/khoá, lý do > 500 ký tự)',
    schema: {
      example: errorExample('reason: admin.validationReasonRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại',
    schema: { example: errorExample('Shop not found') },
  })
  @ApiResponse({
    status: 409,
    description:
      'Shop không còn ở trạng thái cho phép chuyển (đã có người xử lý, hoặc cạnh không hợp lệ)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Cannot change shop status from APPROVED to APPROVED',
        code: 'SHOP_INVALID_TRANSITION',
      },
    },
  })
  async updateShopStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminUpdateShopStatusSchema))
    dto: UpdateShopStatusDto,
  ) {
    const shop = await this.adminService.updateShopStatus(
      admin.userId,
      id,
      dto,
    );
    return { shop };
  }
}
