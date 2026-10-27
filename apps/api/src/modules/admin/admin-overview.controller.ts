import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import {
  FORBIDDEN_ROLE_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import { AdminOverviewService } from './admin-overview.service';

// Trang tổng quan của khu quản trị — chỉ role ADMIN (Week11.md 2.5). Quyền thật nằm ở đây (BE); guard FE chỉ để điều
// hướng. Controller chỉ nhận request và gọi service.
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
export class AdminOverviewController {
  constructor(private readonly adminOverviewService: AdminOverviewService) {}

  // Cache-Control: no-store — số đếm thay đổi từng giây và là dữ liệu quản trị; không để trình duyệt / proxy giữ bản cũ.
  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Số việc đang chờ Admin xử lý, đếm trực tiếp từ dữ liệu: shop chờ duyệt, khiếu nại đã lên sàn, khoản hoàn cần xử lý, thanh toán cần hoàn — chỉ ADMIN',
    description:
      'Mỗi số bằng đúng `total` của tab tương ứng: pendingShops = /admin/shops?status=PENDING; escalatedRefundRequests = ' +
      '/admin/refund-requests?status=ESCALATED; refundsNeedingAction = /admin/refunds (NEEDS_ACTION: FAILED + PENDING bị bỏ dở); ' +
      'refundablePayments = /admin/refundable-payments. Không cache (Cache-Control: no-store).',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          pendingShops: 3,
          escalatedRefundRequests: 1,
          refundsNeedingAction: 2,
          refundablePayments: 0,
        },
      },
    },
  })
  getOverview() {
    return this.adminOverviewService.getOverview();
  }
}
