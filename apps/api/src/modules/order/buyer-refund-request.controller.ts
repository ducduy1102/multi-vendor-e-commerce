import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { OrderQueryService } from './order-query.service';
import { REFUND_REQUEST_EXAMPLE } from './order-swagger-examples';
import { RefundRequestActionService } from './refund-request-action.service';

const REFUND_REQUEST_NOT_FOUND_EXAMPLE = errorExample(
  'Refund request not found',
  { code: 'REFUND_REQUEST_NOT_FOUND' },
);

// Hành động của NGƯỜI MUA lên yêu cầu hủy/trả hàng của chính mình (Week9.md 2.6): rút và khiếu nại lên sàn.
// Gửi yêu cầu mới nằm ở `POST /orders/:id/refund-requests` (BuyerOrderController). Yêu cầu của người khác /
// không tồn tại cùng trả 404 (không lộ id nào có thật). Mọi hành động trả CHI TIẾT đơn mới nhất (đọc lại sau khi
// commit) để FE cập nhật ngay không cần gọi thêm.
@ApiTags('orders')
@Controller('refund-requests')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
export class BuyerRefundRequestController {
  constructor(
    private readonly refundRequestActionService: RefundRequestActionService,
    private readonly orderQueryService: OrderQueryService,
  ) {}

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rút yêu cầu hủy / trả hàng của tôi — chỉ khi seller CHƯA trả lời (trạng thái PENDING_SELLER). Rút xong có thể gửi lại yêu cầu mới',
  })
  @ApiParam({ name: 'id', description: 'ID yêu cầu' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết đơn sau khi rút (`refundRequest` là null)',
    schema: {
      example: {
        success: true,
        data: {
          id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
          refundRequest: null,
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Yêu cầu không tồn tại hoặc không phải của bạn',
    schema: { example: REFUND_REQUEST_NOT_FOUND_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_INVALID_TRANSITION = yêu cầu không còn ở trạng thái chờ seller (seller vừa trả lời / đã xử lý)',
    schema: {
      example: errorExample(
        'Cannot change refund request status from APPROVED to WITHDRAWN',
        { code: 'REFUND_REQUEST_INVALID_TRANSITION' },
      ),
    },
  })
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const { orderId } = await this.refundRequestActionService.withdrawForBuyer(
      user.userId,
      id,
    );
    return this.orderQueryService.getForBuyer(user.userId, orderId);
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Khiếu nại lên sàn khi seller đã TỪ CHỐI yêu cầu của tôi — một lần duy nhất, trong REFUND_ESCALATE_DAYS (mặc định 3 ngày) kể từ lúc bị từ chối. Admin sẽ quyết định',
  })
  @ApiParam({ name: 'id', description: 'ID yêu cầu' })
  @ApiResponse({
    status: 200,
    description:
      'Chi tiết đơn sau khi khiếu nại (`refundRequest.status` = ESCALATED)',
    schema: {
      example: {
        success: true,
        data: {
          id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
          refundRequest: {
            ...REFUND_REQUEST_EXAMPLE,
            status: 'ESCALATED',
            canWithdraw: false,
            canEscalate: false,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Yêu cầu không tồn tại hoặc không phải của bạn',
    schema: { example: REFUND_REQUEST_NOT_FOUND_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_NOT_ALLOWED (details.reason = WINDOW_EXPIRED: quá hạn khiếu nại); REFUND_REQUEST_INVALID_TRANSITION = yêu cầu không ở trạng thái bị seller từ chối (chưa trả lời, đã khiếu nại, đã có kết quả...)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Refund request is not allowed: WINDOW_EXPIRED',
        code: 'REFUND_REQUEST_NOT_ALLOWED',
        details: { reason: 'WINDOW_EXPIRED' },
      },
    },
  })
  async escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const { orderId } = await this.refundRequestActionService.escalateForBuyer(
      user.userId,
      id,
    );
    return this.orderQueryService.getForBuyer(user.userId, orderId);
  }
}
