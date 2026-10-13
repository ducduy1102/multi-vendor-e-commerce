import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  cancelOrderSchema,
  createRefundRequestSchema,
  orderListQuerySchema,
  orderTabSchema,
  type CancelOrderInput,
  type CreateRefundRequestInput,
  type OrderListQuery,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { OrderActionService } from './order-action.service';
import {
  CONFIRMED_ORDER_DETAIL_EXAMPLE,
  ORDER_DETAIL_EXAMPLE,
  ORDER_DETAIL_ITEM_EXAMPLE,
  ORDER_LIST_ITEM_EXAMPLE,
  ORDER_NOT_FOUND_EXAMPLE,
  REFUND_REQUEST_EXAMPLE,
} from './order-swagger-examples';
import { OrderQueryService } from './order-query.service';
import { RefundRequestActionService } from './refund-request-action.service';

// Đơn của buyer đang đăng nhập (Week8.md 2.4). Mọi truy vấn lọc theo userId lấy từ token. Hành động: hủy,
// xác nhận đã nhận (Week8.md 2.6) và gửi yêu cầu hủy/trả hàng (Week9.md 2.6); rút/khiếu nại yêu cầu nằm ở
// `BuyerRefundRequestController`. Route thanh toán của cổng nằm ở `OrderController` (`/payments/...`),
// không liên quan.
@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
export class BuyerOrderController {
  constructor(
    private readonly orderQueryService: OrderQueryService,
    private readonly orderActionService: OrderActionService,
    private readonly refundRequestActionService: RefundRequestActionService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Danh sách đơn hàng của tôi — lọc theo tab trạng thái, phân trang, mới nhất trước',
  })
  @ApiQuery({
    name: 'tab',
    required: false,
    enum: orderTabSchema.options,
    description: 'Nhóm trạng thái; bỏ trống = tất cả',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          items: [ORDER_LIST_ITEM_EXAMPLE],
          total: 1,
          page: 1,
          limit: 10,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (tab lạ, limit > 50...)',
    schema: {
      example: errorExample(
        "tab: Invalid enum value. Expected 'awaiting-payment' | 'pending' | 'processing' | 'shipping' | 'completed' | 'cancelled', received 'bad'",
      ),
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ) {
    return this.orderQueryService.listForBuyer(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Chi tiết 1 đơn của tôi — địa chỉ nhận và dòng hàng lúc đặt, lời nhắn tôi đã gửi cho shop (`buyerNote`, null nếu không có), timeline trạng thái',
    description:
      'Mỗi dòng hàng kèm `productId`/`productSlug` (dựng link sản phẩm), `canReview` (đơn COMPLETED, còn trong REVIEW_WINDOW_DAYS, chưa đánh giá sản phẩm này trong đơn này, và sản phẩm không thuộc shop của chính tôi) và `review` (đánh giá của chính tôi, null nếu chưa có).',
  })
  @ApiParam({ name: 'id', description: 'ID đơn hàng' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: ORDER_DETAIL_EXAMPLE } },
  })
  @ApiResponse({
    status: 404,
    description:
      'Đơn không tồn tại hoặc không phải của bạn (không phân biệt, không lộ id nào có thật)',
    schema: { example: ORDER_NOT_FOUND_EXAMPLE },
  })
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orderQueryService.getForBuyer(user.userId, id);
  }
  // Hành động trả lại CHI TIẾT đơn mới nhất (đọc lại sau khi commit) để FE cập nhật ngay không cần gọi thêm.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hủy đơn của tôi — đơn chưa thanh toán (hủy CẢ NHÓM thanh toán chứa đơn này) hoặc đơn đang chờ shop xác nhận (đã trả online ⇒ hoàn tiền tự động về nguồn thanh toán; chi tiết đơn trả `refund` cho biết đang hoàn hay đã hoàn)',
  })
  @ApiParam({ name: 'id', description: 'ID đơn hàng' })
  @ApiBody({
    required: false,
    schema: { example: { reason: 'Đặt nhầm sản phẩm' } },
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết đơn sau khi hủy (status CANCELLED)',
    schema: {
      example: {
        success: true,
        data: {
          ...ORDER_DETAIL_EXAMPLE,
          status: 'CANCELLED',
          canCancel: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Lý do quá dài (tối đa 500 ký tự)',
    schema: { example: errorExample('reason: order.validationReasonTooLong') },
  })
  @ApiResponse({
    status: 404,
    description: 'Đơn không tồn tại hoặc không phải của bạn',
    schema: { example: ORDER_NOT_FOUND_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_CANCEL_NOT_ALLOWED (details.reason: PROCESSING_STARTED = shop đã xác nhận/đóng gói ⇒ gửi YÊU CẦU hủy thay vì hủy ngay; IN_TRANSIT = đã giao cho vận chuyển); ORDER_INVALID_TRANSITION = đơn đã kết thúc; ORDER_ALREADY_CHANGED = vừa bị đổi bởi yêu cầu khác (vd shop vừa xác nhận)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Order cannot be cancelled: PROCESSING_STARTED',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PROCESSING_STARTED' },
      },
    },
  })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default {} để lý do thật sự tuỳ chọn.
    @Body(new ZodValidationPipe(cancelOrderSchema.default({})))
    body: CancelOrderInput,
  ) {
    await this.orderActionService.cancelByBuyer(user.userId, id, body.reason);
    return this.orderQueryService.getForBuyer(user.userId, id);
  }

  @Post(':id/refund-requests')
  @ApiOperation({
    summary:
      'Gửi yêu cầu hủy / trả hàng-hoàn tiền cho đơn của tôi. Loại yêu cầu do BE suy từ trạng thái đơn: shop đã xác nhận/đóng gói ⇒ yêu cầu HỦY (seller duyệt; quá hạn phản hồi hệ thống tự duyệt); đã nhận hàng, trong cửa sổ hoàn trả ⇒ yêu cầu TRẢ HÀNG (seller duyệt; từ chối thì khiếu nại lên sàn; quá hạn chuyển Admin)',
  })
  @ApiParam({ name: 'id', description: 'ID đơn hàng' })
  @ApiBody({
    schema: {
      example: {
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Đổi ý, không cần nữa',
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Chi tiết đơn sau khi gửi — `refundRequest` là yêu cầu vừa tạo (PENDING_SELLER)',
    schema: {
      example: {
        success: true,
        data: {
          ...CONFIRMED_ORDER_DETAIL_EXAMPLE,
          canRequestCancel: false,
          refundRequest: REFUND_REQUEST_EXAMPLE,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Thiếu/sai lý do, lý do không thuộc loại yêu cầu của đơn, chọn OTHER mà không ghi chú, ghi chú quá dài (tối đa 500 ký tự)',
    schema: {
      example: errorExample('reasonCode: order.validationRefundReasonInvalid'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Đơn không tồn tại hoặc không phải của bạn',
    schema: { example: ORDER_NOT_FOUND_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_NOT_ALLOWED (details.reason: NOT_ELIGIBLE_STATUS = đơn không ở CONFIRMED/PACKED/COMPLETED; WINDOW_EXPIRED = quá cửa sổ trả hàng; ALREADY_REQUESTED = đã có yêu cầu cùng loại chưa rút; PAYMENT_NOT_COLLECTED = đơn online chưa có thanh toán thành công); ORDER_ALREADY_CHANGED = đơn vừa đổi trạng thái',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Refund request is not allowed: ALREADY_REQUESTED',
        code: 'REFUND_REQUEST_NOT_ALLOWED',
        details: { reason: 'ALREADY_REQUESTED' },
      },
    },
  })
  async requestRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default {} để lỗi báo theo field reasonCode
    // (giống gửi `{}`) thay vì "value: Required".
    @Body(
      new ZodValidationPipe(
        createRefundRequestSchema.default({} as CreateRefundRequestInput),
      ),
    )
    body: CreateRefundRequestInput,
  ) {
    await this.refundRequestActionService.createForBuyer(user.userId, id, body);
    return this.orderQueryService.getForBuyer(user.userId, id);
  }

  @Post(':id/confirm-received')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Xác nhận đã nhận hàng (SHIPPING → COMPLETED). Đơn COD: khi mọi đơn không bị hủy của nhóm đã hoàn tất, ghi nhận đã thu tiền',
  })
  @ApiParam({ name: 'id', description: 'ID đơn hàng' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết đơn sau khi hoàn tất (status COMPLETED)',
    schema: {
      example: {
        success: true,
        data: {
          ...ORDER_DETAIL_EXAMPLE,
          status: 'COMPLETED',
          canCancel: false,
          // Vừa hoàn tất ⇒ còn trong cửa sổ đánh giá.
          items: [{ ...ORDER_DETAIL_ITEM_EXAMPLE, canReview: true }],
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Đơn không tồn tại hoặc không phải của bạn',
    schema: { example: ORDER_NOT_FOUND_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_INVALID_TRANSITION = đơn chưa ở trạng thái đang giao; ORDER_ALREADY_CHANGED = vừa bị đổi bởi yêu cầu khác',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Action is not allowed while the order is PACKED',
        code: 'ORDER_INVALID_TRANSITION',
      },
    },
  })
  async confirmReceived(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.orderActionService.confirmReceived(user.userId, id);
    return this.orderQueryService.getForBuyer(user.userId, id);
  }
}
