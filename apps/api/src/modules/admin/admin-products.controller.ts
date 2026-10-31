import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
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
import { Role } from '@prisma/client';
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
import { AdminProductsService } from './admin-products.service';
import {
  restoreProductSchema,
  takeDownProductSchema,
  type RestoreProductDto,
  type TakeDownProductDto,
} from './dto/take-down-product.dto';

const PRODUCT_ID_PARAM = { name: 'id', description: 'ID sản phẩm (UUID)' };
const NOT_FOUND = {
  status: 404,
  description: 'Sản phẩm không tồn tại (hoặc id sai dạng)',
  schema: {
    example: errorExample('Product not found', { code: 'PRODUCT_NOT_FOUND' }),
  },
};
const BAD_REASON = {
  status: 400,
  description: 'Thiếu lý do, lý do quá 500 ký tự hoặc có ký tự điều khiển',
  schema: { example: errorExample('reason: admin.validationReasonRequired') },
};

// Gỡ / khôi phục sản phẩm vi phạm (Week11.md 5.7, D5) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng. Controller chỉ
// nhận request và gọi service. Cùng luật gỡ được dùng khi Admin xử lý một báo cáo sản phẩm (`POST /admin/reports/:id/resolve`,
// TAKE_DOWN_PRODUCT).
@ApiTags('admin')
@Controller('admin/products')
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
export class AdminProductsController {
  constructor(private readonly adminProductsService: AdminProductsService) {}

  // Gỡ ≠ tạo tài nguyên ⇒ 200 (khai tường minh; Swagger @ApiResponse không tự đọc lại status thật).
  @Post(':id/take-down')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Gỡ một sản phẩm vi phạm — chỉ ADMIN',
    description:
      'Chuyển sản phẩm DRAFT/PUBLISHED/ARCHIVED sang TAKEN_DOWN: biến khỏi mọi trang công khai (trả 404 cho người ngoài), giỏ hàng và ' +
      'wishlist đánh dấu không còn bán, checkout từ chối; đơn đã đặt không bị ảnh hưởng. Chủ shop không đổi trạng thái hay sửa nội dung ' +
      'được nữa (409 PRODUCT_TAKEN_DOWN). `reason` bắt buộc (1–500 ký tự), lưu ở nhật ký quản trị TAKE_DOWN_PRODUCT và cột lý do — và ' +
      'HIỆN cho chủ shop (trang sửa, danh sách sản phẩm, thông báo), nên viết như lời giải thích cho họ, không nêu người báo cáo.',
  })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiBody({
    schema: {
      example: { reason: 'Bán hàng cấm: dao bấm tự động lò xo.' },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          product: {
            id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
            status: 'TAKEN_DOWN',
            takenDownAt: '2026-10-31T03:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse(BAD_REASON)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description: 'PRODUCT_ALREADY_TAKEN_DOWN: sản phẩm đã bị gỡ từ trước',
    schema: {
      example: errorExample('This product is already taken down', {
        code: 'PRODUCT_ALREADY_TAKEN_DOWN',
      }),
    },
  })
  takeDown(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(takeDownProductSchema))
    body: TakeDownProductDto,
    @Req() req: Request,
  ) {
    return this.adminProductsService.takeDown(
      admin.userId,
      id,
      body.reason,
      auditRequestContext(req),
    );
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Khôi phục một sản phẩm đã bị gỡ — chỉ ADMIN',
    description:
      'Chỉ từ TAKEN_DOWN, về NHÁP (DRAFT): chủ shop tự sửa rồi xuất bản lại, sản phẩm không tự bán lại. Xoá lý do gỡ. `reason` bắt buộc, ' +
      'chỉ nằm ở nhật ký quản trị RESTORE_PRODUCT. Không gửi thông báo cho chủ shop.',
  })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiBody({
    schema: { example: { reason: 'Đã xét lại, sản phẩm không vi phạm.' } },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          product: {
            id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
            status: 'DRAFT',
            takenDownAt: null,
          },
        },
      },
    },
  })
  @ApiResponse(BAD_REASON)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description: 'PRODUCT_NOT_TAKEN_DOWN: sản phẩm không ở trạng thái bị gỡ',
    schema: {
      example: errorExample('This product is not taken down', {
        code: 'PRODUCT_NOT_TAKEN_DOWN',
      }),
    },
  })
  restore(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(restoreProductSchema)) body: RestoreProductDto,
    @Req() req: Request,
  ) {
    return this.adminProductsService.restore(
      admin.userId,
      id,
      body.reason,
      auditRequestContext(req),
    );
  }
}
