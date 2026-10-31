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
import { AdminReviewsService } from './admin-reviews.service';
import {
  hideReviewSchema,
  unhideReviewSchema,
  type HideReviewDto,
  type UnhideReviewDto,
} from './dto/hide-review.dto';

const REVIEW_ID_PARAM = { name: 'id', description: 'ID đánh giá (UUID)' };
const REASON_BODY = {
  schema: {
    example: { reason: 'Ngôn từ xúc phạm, vi phạm quy định cộng đồng.' },
  },
};
const NOT_FOUND = {
  status: 404,
  description: 'Đánh giá không tồn tại (hoặc id sai dạng)',
  schema: {
    example: errorExample('Review not found', { code: 'REVIEW_NOT_FOUND' }),
  },
};

// Ẩn / hiện đánh giá (Week11.md 5.5, D6) — chỉ role ADMIN. Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng. Controller chỉ nhận
// request và gọi service. Cùng luật được dùng khi Admin xử lý một báo cáo đánh giá (`POST /admin/reports/:id/resolve`, HIDE_REVIEW).
@ApiTags('admin')
@Controller('admin/reviews')
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
export class AdminReviewsController {
  constructor(private readonly adminReviewsService: AdminReviewsService) {}

  // Ẩn ≠ tạo tài nguyên ⇒ 200 (khai tường minh; Swagger @ApiResponse không tự đọc lại status thật).
  @Post(':id/hide')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Ẩn một đánh giá — chỉ ADMIN',
    description:
      'Ẩn MỀM (mở lại được): đánh giá biến khỏi trang sản phẩm và danh sách của seller, và khỏi điểm trung bình / số đánh giá của sản ' +
      'phẩm (tính lại trong cùng giao dịch); câu trả lời của shop ẩn theo. Tác giả nhận thông báo (không nêu lý do), vẫn xem được bản ' +
      'của mình kèm nhãn "đã bị ẩn" và không sửa được. `reason` bắt buộc (1–500 ký tự), lưu ở nhật ký quản trị HIDE_REVIEW và cột lý ' +
      'do — và HIỆN cho tác giả (chi tiết đơn) lẫn chủ shop (danh sách đánh giá của shop), nên viết như lời giải thích cho họ, không nêu ' +
      'người báo cáo. Không bao giờ ra trang công khai.',
  })
  @ApiParam(REVIEW_ID_PARAM)
  @ApiBody(REASON_BODY)
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          review: {
            id: 'f7d5a6c4-1234-4a5b-8c9d-abcdef555555',
            isHidden: true,
            hiddenAt: '2026-10-31T03:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu lý do, lý do quá 500 ký tự hoặc có ký tự điều khiển',
    schema: { example: errorExample('reason: admin.validationReasonRequired') },
  })
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description: 'REVIEW_ALREADY_HIDDEN: đánh giá đã bị ẩn từ trước',
    schema: {
      example: errorExample('This review is already hidden', {
        code: 'REVIEW_ALREADY_HIDDEN',
      }),
    },
  })
  hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hideReviewSchema)) body: HideReviewDto,
    @Req() req: Request,
  ) {
    return this.adminReviewsService.hide(
      admin.userId,
      id,
      body.reason,
      auditRequestContext(req),
    );
  }

  @Post(':id/unhide')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Mở lại một đánh giá đã ẩn — chỉ ADMIN',
    description:
      'Đưa đánh giá trở lại danh sách công khai và điểm trung bình (tính lại trong cùng giao dịch). `reason` bắt buộc, chỉ nằm ở nhật ' +
      'ký quản trị UNHIDE_REVIEW. Không gửi thông báo cho tác giả.',
  })
  @ApiParam(REVIEW_ID_PARAM)
  @ApiBody(REASON_BODY)
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          review: {
            id: 'f7d5a6c4-1234-4a5b-8c9d-abcdef555555',
            isHidden: false,
            hiddenAt: null,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu lý do, lý do quá 500 ký tự hoặc có ký tự điều khiển',
    schema: { example: errorExample('reason: admin.validationReasonRequired') },
  })
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description: 'REVIEW_NOT_HIDDEN: đánh giá đang hiển thị',
    schema: {
      example: errorExample('This review is not hidden', {
        code: 'REVIEW_NOT_HIDDEN',
      }),
    },
  })
  unhide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(unhideReviewSchema)) body: UnhideReviewDto,
    @Req() req: Request,
  ) {
    return this.adminReviewsService.unhide(
      admin.userId,
      id,
      body.reason,
      auditRequestContext(req),
    );
  }
}
