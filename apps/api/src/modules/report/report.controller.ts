import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
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
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import {
  createReportSchema,
  type CreateReportDto,
} from './dto/create-report.dto';
import { ReportService } from './report.service';

// `report` không import `auth` (ranh giới module): chỉ cần `userId` nên dùng kiểu cấu trúc nhỏ thay vì AuthenticatedUser.
interface Caller {
  userId: string;
}

// Ví dụ chỉ là annotation — khớp createReportSchema / createReportResponseSchema ở packages/types.
const CREATE_BODY_EXAMPLE = {
  targetType: 'REVIEW',
  targetId: '0b7d9a52-3c1e-4f4d-8f27-6a1d5e9c2b10',
  reasonCode: 'FAKE_REVIEW',
  note: 'Người này chưa từng mua hàng của shop.',
};
const RECEIPT_EXAMPLE = {
  report: {
    id: 'f1a2b3c4-1234-4a5b-8c9d-abcdef888888',
    targetType: 'REVIEW',
    status: 'OPEN',
    createdAt: '2026-10-31T02:00:00.000Z',
  },
};

// Báo cáo vi phạm của người dùng (Week11.md 5.3, D5). Controller chỉ nhận request và gọi service; luật "ai được báo gì" nằm ở
// ReportService và ReportTargetDirectory. CHỈ MỘT route: người báo gửi báo cáo, còn xem hàng đợi và xử lý là việc của Admin
// (`/admin/reports`). Cố ý KHÔNG có route đọc nào ở đây — người bị báo (chủ shop, tác giả đánh giá) không có đường nào thấy báo cáo,
// và người báo chỉ nhận biên nhận tối thiểu.
@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Email chưa xác thực',
  schema: {
    example: errorExample('EMAIL_NOT_VERIFIED', { code: 'EMAIL_NOT_VERIFIED' }),
  },
})
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Báo cáo một đánh giá, hội thoại, shop hoặc sản phẩm',
    description:
      'Cần đăng nhập và xác thực email. `targetType` = REVIEW | CONVERSATION | SHOP | PRODUCT; `reasonCode` phải thuộc đúng loại ' +
      '(chọn OTHER thì bắt buộc `note`, tối đa 500 ký tự). Không tự báo nội dung/shop/sản phẩm của chính mình. Hội thoại chỉ hai ' +
      'thành viên báo được; đối tượng không tồn tại, không còn công khai hoặc (hội thoại) người báo không phải thành viên đều ' +
      'trả cùng một 404. Mỗi người chỉ có một báo cáo ĐANG MỞ về một đối tượng, và tối đa 10 báo cáo trong 24 giờ. Người báo, ' +
      'trạng thái và ảnh chụp do server quyết định. Mọi Admin ACTIVE nhận thông báo. Người bị báo không có cách nào thấy người báo.',
  })
  @ApiBody({ schema: { example: CREATE_BODY_EXAMPLE } })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: RECEIPT_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Thiếu/sai loại đối tượng, id không phải UUID, lý do không thuộc loại, thiếu ghi chú khi chọn OTHER, ghi chú quá 500 ký tự hoặc có ký tự điều khiển',
    schema: {
      example: errorExample('reasonCode: report.validationReasonInvalid'),
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Đối tượng không tồn tại, không còn công khai hoặc người báo không phải thành viên của hội thoại (REPORT_TARGET_NOT_FOUND)',
    schema: {
      example: errorExample(
        'The content you are trying to report could not be found',
        { code: 'REPORT_TARGET_NOT_FOUND' },
      ),
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'Báo cáo nội dung của chính mình (REPORT_OWN_CONTENT) hoặc đã có báo cáo đang mở về đối tượng này (REPORT_ALREADY_OPEN)',
    schema: {
      example: errorExample(
        'You already have an open report about this content',
        {
          code: 'REPORT_ALREADY_OPEN',
        },
      ),
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Quá 10 báo cáo trong 24 giờ (REPORT_LIMIT_REACHED)',
    schema: {
      example: errorExample('You have sent too many reports recently', {
        code: 'REPORT_LIMIT_REACHED',
      }),
    },
  })
  create(
    @CurrentUser() user: Caller,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportDto,
  ) {
    return this.reportService.create(user.userId, body);
  }
}
