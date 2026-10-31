import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
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
import {
  ADMIN_REPORT_LIST_FILTERS,
  REPORT_RESOLUTION_ACTIONS,
  REPORT_TARGET_TYPES,
} from '@ecommerce/types';
import type { Request } from 'express';
import { auditRequestContext } from '../../shared/audit/audit-request-context';
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
import { AdminReportsService } from './admin-reports.service';
import {
  adminReportListQuerySchema,
  type ListAdminReportsQueryDto,
} from './dto/list-admin-reports-query.dto';
import {
  resolveReportSchema,
  type ResolveReportDto,
} from './dto/resolve-report.dto';

// Ví dụ chỉ là annotation — khớp adminReportSchema ở packages/types.
const ADMIN_REPORT_EXAMPLE = {
  id: 'f7d5a6c4-1234-4a5b-8c9d-abcdef999999',
  targetType: 'SHOP',
  targetId: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  status: 'OPEN',
  reasonCode: 'COUNTERFEIT',
  note: 'Shop bán hàng nhái thương hiệu.',
  reporter: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
  createdAt: '2026-10-31T02:00:00.000Z',
  resolution: null,
  sameTargetOpenCount: 2,
  snapshot: { name: 'Shop Thời Trang ABC', slug: 'shop-thoi-trang-abc' },
};

const REPORT_ID_PARAM = { name: 'id', description: 'ID báo cáo (UUID)' };

// Hàng đợi báo cáo vi phạm (Week11.md 5.4, D5) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng. Controller chỉ
// nhận request và gọi service. Người dùng gửi báo cáo ở `POST /reports` (module report); người bị báo không có route nào đọc báo cáo.
@ApiTags('admin')
@Controller('admin/reports')
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
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Danh sách báo cáo vi phạm, lọc theo trạng thái và loại — chỉ ADMIN',
    description:
      '`status` mặc định OPEN (chờ xử lý, cũ nhất trước); CLOSED = đã xử lý hoặc bỏ qua, xử lý gần nhất trước. `targetType` ' +
      '(REVIEW | CONVERSATION | SHOP | PRODUCT) để trống = mọi loại. Mỗi báo cáo mang ảnh chụp đối tượng lúc báo, người báo (tên + ' +
      'email), kết quả xử lý và `sameTargetOpenCount` (số báo cáo đang mở khác về cùng đối tượng). Không cache (Cache-Control: ' +
      'no-store).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [...ADMIN_REPORT_LIST_FILTERS],
    example: 'OPEN',
  })
  @ApiQuery({
    name: 'targetType',
    required: false,
    enum: [...REPORT_TARGET_TYPES],
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
        data: { items: [ADMIN_REPORT_EXAMPLE], total: 1, page: 1, limit: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Query không hợp lệ (status/targetType lạ, limit > 50, page quá trần...)',
    schema: { example: errorExample('status: Invalid enum value') },
  })
  list(
    @Query(new ZodValidationPipe(adminReportListQuerySchema))
    query: ListAdminReportsQueryDto,
  ) {
    return this.adminReportsService.list(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Chi tiết một báo cáo vi phạm — chỉ ADMIN',
    description:
      'Cùng hình dạng một dòng của danh sách. Ảnh chụp của báo cáo hội thoại KHÔNG có nội dung tin nhắn (đọc chat có đường riêng, ' +
      'ghi nhật ký truy cập). Không cache.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { report: ADMIN_REPORT_EXAMPLE } },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Báo cáo không tồn tại (hoặc id sai dạng)',
    schema: {
      example: errorExample('Report not found', { code: 'REPORT_NOT_FOUND' }),
    },
  })
  detail(@Param('id') id: string) {
    return this.adminReportsService.detail(id);
  }

  // Xử lý ≠ tạo tài nguyên ⇒ 200 (khai tường minh; Swagger @ApiResponse không tự đọc lại status thật).
  @Post(':id/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Xử lý một báo cáo đang mở: chọn hành động hoặc bỏ qua — chỉ ADMIN',
    description:
      '`action` thuộc đúng loại báo cáo (REVIEW: HIDE_REVIEW | DISMISS; SHOP: SUSPEND_SHOP | DISMISS; PRODUCT: TAKE_DOWN_PRODUCT | ' +
      'DISMISS; CONVERSATION: SUSPEND_REPORTED_USER | BLOCK_BUYER | DISMISS). Mọi hành động trừ DISMISS bắt buộc có `note` (lý do, ' +
      'hiện cho bên bị xử lý). Hành động chạy trong CÙNG giao dịch với việc đóng báo cáo, và mọi báo cáo đang mở khác về CÙNG đối ' +
      'tượng đóng luôn cùng kết quả; mỗi người báo nhận một thông báo chung chung. Ghi nhật ký quản trị RESOLVE_REPORT. Admin thứ ' +
      'hai xử lý cùng đối tượng nhận 409.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiBody({
    schema: {
      example: {
        action: REPORT_RESOLUTION_ACTIONS[1],
        note: 'Bán hàng nhái thương hiệu, đã có nhiều báo cáo.',
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          report: {
            ...ADMIN_REPORT_EXAMPLE,
            status: 'RESOLVED',
            sameTargetOpenCount: 0,
            resolution: {
              action: 'SUSPEND_SHOP',
              note: 'Bán hàng nhái thương hiệu, đã có nhiều báo cáo.',
              resolvedByName: 'Quản trị viên',
              resolvedAt: '2026-10-31T03:00:00.000Z',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (hành động lạ, thiếu ghi chú khi không phải DISMISS, ghi chú quá 500 ký tự...)',
    schema: {
      example: errorExample('note: admin.validationReportNoteRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Báo cáo không tồn tại (hoặc id sai dạng)',
    schema: {
      example: errorExample('Report not found', { code: 'REPORT_NOT_FOUND' }),
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'REPORT_ALREADY_CLOSED: đã có Admin khác xử lý; REPORT_ACTION_NOT_ALLOWED: hành động không dùng được cho loại báo cáo ' +
      'này; hoặc lỗi của hành động (SHOP_INVALID_TRANSITION, CANNOT_MODIFY_ADMIN, CANNOT_MODIFY_SELF...)',
    schema: {
      example: errorExample('This report was already handled', {
        code: 'REPORT_ALREADY_CLOSED',
      }),
    },
  })
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) body: ResolveReportDto,
    @Req() req: Request,
  ) {
    return this.adminReportsService.resolve(
      admin.userId,
      id,
      body,
      auditRequestContext(req),
    );
  }
}
