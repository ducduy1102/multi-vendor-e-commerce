import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { accountStatusSchema, userRoleSchema } from '@ecommerce/types';
import { Roles } from '../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  FORBIDDEN_ROLE_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import { AdminUserService } from './admin-user.service';
import {
  adminUserListQuerySchema,
  type ListUsersQueryDto,
} from './dto/list-users-query.dto';

// Ví dụ chỉ là annotation — khớp adminUserSchema / adminUserDetailSchema ở packages/types.
const ADMIN_USER_EXAMPLE = {
  id: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
  email: 'nguyenvana@example.com',
  name: 'Nguyễn Văn A',
  role: 'USER',
  accountStatus: 'SUSPENDED',
  statusReason: 'Vi phạm điều khoản sử dụng',
  statusChangedAt: '2026-10-27T10:00:00.000Z',
  isEmailVerified: true,
  createdAt: '2026-10-01T00:00:00.000Z',
};

// Quản lý người dùng của Admin (Week11.md 3.2) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng.
// Controller chỉ nhận request và gọi service. Dữ liệu tài khoản là riêng tư nên mọi GET đều `Cache-Control: no-store`.
@ApiTags('admin')
@Controller('admin/users')
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
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Danh sách người dùng: tìm theo email / tên, lọc vai và trạng thái, mới tạo trước — chỉ ADMIN',
    description:
      '`q` khớp một PHẦN của email hoặc tên, không phân biệt hoa-thường và dấu (`nguyen` ra `Nguyễn`); các ký tự `%` `_` `\\` ' +
      'được hiểu đúng nghĩa đen. Bỏ trống `role` / `status` = mọi vai / mọi trạng thái (kể cả DEACTIVATED). Response chỉ gồm ' +
      'các trường trong allowlist: không bao giờ có mật khẩu, token hay mốc xác thực email. Không cache (Cache-Control: no-store).',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Từ khoá email hoặc tên, tối đa 254 ký tự, một dòng',
  })
  @ApiQuery({ name: 'role', required: false, enum: userRoleSchema.options })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: accountStatusSchema.options,
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
        data: { items: [ADMIN_USER_EXAMPLE], total: 1, page: 1, limit: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Query không hợp lệ (limit > 50, vai / trạng thái lạ, `q` có ký tự điều khiển...)',
    schema: {
      example: errorExample('q: admin.validationSearchUnsafe'),
    },
  })
  listUsers(
    @Query(new ZodValidationPipe(adminUserListQuerySchema))
    query: ListUsersQueryDto,
  ) {
    return this.adminUserService.listUsers(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Chi tiết một người dùng: tài khoản, shop sở hữu, số đơn đã đặt và lịch sử nhật ký quản trị về tài khoản — chỉ ADMIN',
    description:
      'Lịch sử là tối đa 20 dòng mới nhất của nhật ký quản trị có đối tượng là chính tài khoản này (kèm tên Admin thực ' +
      'hiện); không có IP hay User-Agent. Id không tồn tại và id sai dạng cùng trả một 404 giống hệt nhau.',
  })
  @ApiParam({ name: 'id', description: 'ID người dùng (UUID)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          ...ADMIN_USER_EXAMPLE,
          locale: 'vi',
          orderCount: 3,
          shops: [
            {
              id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
              name: 'Shop Thời Trang ABC',
              slug: 'shop-thoi-trang-abc',
              status: 'SUSPENDED',
            },
          ],
          history: [
            {
              id: 'd5b3e4a2-1234-4a5b-8c9d-abcdef999999',
              action: 'SUSPEND_USER',
              actorId: 'e6c4f5b3-1234-4a5b-8c9d-abcdef888888',
              actorName: 'Quản trị viên',
              reason: 'Vi phạm điều khoản sử dụng',
              meta: { from: 'ACTIVE', to: 'SUSPENDED' },
              createdAt: '2026-10-27T10:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Người dùng không tồn tại (hoặc id sai dạng)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      },
    },
  })
  getUser(@Param('id') id: string) {
    return this.adminUserService.getUser(id);
  }
}
