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
import { APPEAL_STATES } from '@ecommerce/types';
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
import { AdminAppealsService } from './admin-appeals.service';
import {
  decideAppealSchema,
  type DecideAppealDto,
} from './dto/decide-appeal.dto';
import {
  adminAppealListQuerySchema,
  type ListAdminAppealsQueryDto,
} from './dto/list-admin-appeals-query.dto';

// Ví dụ chỉ là annotation — khớp adminAppealSchema ở packages/types.
const ADMIN_APPEAL_EXAMPLE = {
  id: 'f7d5a6c4-1234-4a5b-8c9d-abcdef777777',
  state: 'PENDING',
  message:
    'Shop đã gỡ toàn bộ sản phẩm bị báo cáo và bổ sung giấy tờ nguồn gốc hàng hoá, mong được xem xét lại.',
  decisionNote: null,
  decidedByName: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  decidedAt: null,
  moderationEventAt: '2026-10-28T10:00:00.000Z',
  shop: {
    id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
    name: 'Shop Thời Trang ABC',
    slug: 'shop-thoi-trang-abc',
    logoUrl: null,
    status: 'SUSPENDED',
    statusReason: 'Bán hàng giả',
  },
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
};

const APPEAL_ID_PARAM = { name: 'id', description: 'ID kháng nghị (UUID)' };

// Hàng đợi kháng nghị của shop (Week11.md 4.6, D15) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng.
// Controller chỉ nhận request và gọi service. Chủ shop gửi/xem kháng nghị của mình ở `/shops/:shopId/appeals` (module appeal).
@ApiTags('admin')
@Controller('admin/appeals')
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
export class AdminAppealsController {
  constructor(private readonly adminAppealsService: AdminAppealsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Danh sách kháng nghị của shop, lọc theo trạng thái — chỉ ADMIN',
    description:
      '`status` mặc định PENDING (hàng chờ, cũ nhất trước). CLOSED = còn chờ nhưng lần khoá mà kháng nghị nhắm tới đã kết thúc ' +
      '(shop được mở khoá bằng đường khác hoặc bị khoá lại): không còn gì để quyết định. ACCEPTED/REJECTED mới quyết định nhất ' +
      'trước. Không cache (Cache-Control: no-store).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [...APPEAL_STATES],
    example: 'PENDING',
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
        data: {
          items: [ADMIN_APPEAL_EXAMPLE],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ, limit > 50, page quá trần...)',
    schema: { example: errorExample('status: Invalid enum value') },
  })
  list(
    @Query(new ZodValidationPipe(adminAppealListQuerySchema))
    query: ListAdminAppealsQueryDto,
  ) {
    return this.adminAppealsService.list(query);
  }

  // Quyết định ≠ tạo tài nguyên ⇒ 200 (khai tường minh; Swagger @ApiResponse không tự đọc lại status thật).
  @Post(':id/decide')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Chấp nhận (mở khoá shop) hoặc từ chối một kháng nghị đang chờ — chỉ ADMIN',
    description:
      'ACCEPT đưa shop SUSPENDED → APPROVED trong cùng giao dịch với việc đóng kháng nghị (chủ shop phải còn ACTIVE). REJECT ' +
      'bắt buộc có ghi chú (hiện cho chủ shop). Mỗi kháng nghị chỉ quyết định được MỘT lần: Admin thứ hai nhận 409. Ghi nhật ' +
      'quản trị DECIDE_APPEAL cùng giao dịch.',
  })
  @ApiParam(APPEAL_ID_PARAM)
  @ApiBody({
    schema: {
      example: {
        decision: 'REJECT',
        note: 'Giấy tờ nguồn gốc hàng hoá chưa hợp lệ, vui lòng bổ sung rồi gửi lại sau khi liên hệ hỗ trợ.',
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          appeal: {
            ...ADMIN_APPEAL_EXAMPLE,
            state: 'REJECTED',
            decisionNote: 'Giấy tờ nguồn gốc hàng hoá chưa hợp lệ.',
            decidedByName: 'Quản trị viên',
            decidedAt: '2026-10-29T09:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (thiếu decision, REJECT không có ghi chú, ghi chú quá 500 ký tự...)',
    schema: {
      example: errorExample('note: admin.validationAppealNoteRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Kháng nghị không tồn tại (hoặc id sai dạng)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Appeal not found',
        code: 'APPEAL_NOT_FOUND',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'APPEAL_ALREADY_DECIDED: đã có người quyết định; APPEAL_TARGET_CHANGED: lần khoá mà kháng nghị nhắm tới đã kết thúc; ' +
      'SHOP_OWNER_NOT_ACTIVE: chấp nhận nhưng chủ shop đang bị khoá tài khoản',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'This appeal was already decided',
        code: 'APPEAL_ALREADY_DECIDED',
      },
    },
  })
  decide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideAppealSchema)) body: DecideAppealDto,
    @Req() req: Request,
  ) {
    return this.adminAppealsService.decide(
      admin.userId,
      id,
      body,
      auditRequestContext(req),
    );
  }
}
