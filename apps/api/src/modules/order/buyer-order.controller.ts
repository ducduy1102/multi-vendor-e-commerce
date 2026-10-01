import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  orderListQuerySchema,
  orderTabSchema,
  type OrderListQuery,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
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
// (hủy, xác nhận đã nhận) thêm ở 2.6 — controller này hiện chỉ có đọc. Route thanh toán của cổng
// nằm ở `OrderController` (`/payments/...`), không liên quan.
@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
export class BuyerOrderController {
  constructor(private readonly orderQueryService: OrderQueryService) {}

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
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
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
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description:
      'Đơn không tồn tại hoặc không phải của bạn (không phân biệt, không lộ id nào có thật)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      },
    },
  })
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orderQueryService.getForBuyer(user.userId, id);
  }
}
