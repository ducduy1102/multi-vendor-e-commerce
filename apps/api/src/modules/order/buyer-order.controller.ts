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
  orderListQuerySchema,
  orderTabSchema,
  type CancelOrderInput,
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
import { ORDER_NOT_FOUND_EXAMPLE } from './order-swagger-examples';
import { OrderQueryService } from './order-query.service';

const ORDER_ITEM_EXAMPLE = {
  productName: 'Áo thun cotton',
  variantLabel: 'Đỏ / M',
  sku: 'SKU-AO-DO-M',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/ao-thun.jpg',
  quantity: 2,
  priceAtPurchase: '150000',
};

const ORDER_LIST_ITEM_EXAMPLE = {
  id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
  checkoutGroupId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  status: 'AWAITING_PAYMENT',
  createdAt: '2026-10-01T10:00:00.000Z',
  totalAmount: '320000',
  shop: {
    id: 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003',
    name: 'Shop Áo Xinh',
    slug: 'shop-ao-xinh',
    logoUrl: null,
  },
  items: [ORDER_ITEM_EXAMPLE],
  itemCount: 1,
  paymentMethod: 'VNPAY',
  paymentStatus: 'PENDING',
  canCancel: true,
  canConfirmReceived: false,
  canRetryPayment: true,
};

const ORDER_DETAIL_EXAMPLE = {
  ...ORDER_LIST_ITEM_EXAMPLE,
  recipientName: 'Nguyễn Văn A',
  recipientPhone: '0912345678',
  shippingAddressLine: '12 Nguyễn Huệ',
  shippingWard: 'Phường Bến Nghé',
  shippingProvince: 'Hồ Chí Minh',
  subtotal: '300000',
  discountAmount: '0',
  shippingFee: '20000',
  carrier: null,
  trackingCode: null,
  history: [
    {
      fromStatus: null,
      toStatus: 'AWAITING_PAYMENT',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
};

// Đơn của buyer đang đăng nhập (Week8.md 2.4). Mọi truy vấn lọc theo userId lấy từ token. Hành động
// (hủy, xác nhận đã nhận) ở 2.6. Route thanh toán của cổng nằm ở `OrderController`
// (`/payments/...`), không liên quan.
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
      'Chi tiết 1 đơn của tôi — địa chỉ nhận và dòng hàng lúc đặt, timeline trạng thái',
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
      'Hủy đơn của tôi — đơn chưa thanh toán (hủy CẢ NHÓM thanh toán chứa đơn này) hoặc đơn COD chờ shop xác nhận',
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
      'ORDER_CANCEL_NOT_ALLOWED (details.reason: PAID_ONLINE = đã thanh toán online, PROCESSING_STARTED = shop đã xác nhận trở đi); ORDER_INVALID_TRANSITION = đơn đã kết thúc; ORDER_ALREADY_CHANGED = vừa bị đổi bởi yêu cầu khác (vd shop vừa xác nhận)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Order cannot be cancelled: PAID_ONLINE',
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        details: { reason: 'PAID_ONLINE' },
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
