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
  applyDecorators,
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
  rejectOrderSchema,
  sellerOrderListQuerySchema,
  sellerOrderTabSchema,
  shipOrderSchema,
  type RejectOrderInput,
  type SellerOrderListQuery,
  type ShipOrderInput,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { OrderActionService } from './order-action.service';
import { ORDER_NOT_FOUND_EXAMPLE } from './order-swagger-examples';
import { OrderQueryService } from './order-query.service';

const SELLER_ORDER_LIST_ITEM_EXAMPLE = {
  id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
  status: 'PENDING',
  createdAt: '2026-10-01T10:00:00.000Z',
  totalAmount: '320000',
  recipientName: 'Nguyễn Văn A',
  shippingProvince: 'Hồ Chí Minh',
  items: [
    {
      productName: 'Áo thun cotton',
      variantLabel: 'Đỏ / M',
      sku: 'SKU-AO-DO-M',
      imageUrl: null,
      quantity: 2,
      priceAtPurchase: '150000',
    },
  ],
  itemCount: 1,
  paymentMethod: 'VNPAY',
  paymentStatus: 'SUCCESS',
  canConfirm: true,
  canPack: false,
  canShip: false,
  canReject: false,
};

const SELLER_ORDER_DETAIL_EXAMPLE = {
  ...SELLER_ORDER_LIST_ITEM_EXAMPLE,
  recipientPhone: '0912345678',
  shippingAddressLine: '12 Nguyễn Huệ',
  shippingWard: 'Phường Bến Nghé',
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
    {
      fromStatus: 'AWAITING_PAYMENT',
      toStatus: 'PENDING',
      actorType: 'SYSTEM',
      note: 'Payment confirmed',
      createdAt: '2026-10-01T10:05:00.000Z',
    },
  ],
};

// Phản hồi lỗi chung của 4 hành động (xác nhận/đóng gói/giao/từ chối).
const ApiActionErrors = () =>
  applyDecorators(
    ApiResponse({
      status: 404,
      description:
        'Shop không tồn tại; hoặc đơn không tồn tại / thuộc shop khác / chưa thanh toán (không phân biệt)',
      schema: { example: ORDER_NOT_FOUND_EXAMPLE },
    }),
    ApiResponse({
      status: 409,
      description:
        'ORDER_INVALID_TRANSITION = đơn không ở trạng thái cho phép làm hành động này; ORDER_CANCEL_NOT_ALLOWED (chỉ reject; details.reason PAID_ONLINE | PROCESSING_STARTED); ORDER_ALREADY_CHANGED = vừa bị đổi bởi yêu cầu khác (vd buyer vừa hủy)',
      schema: {
        example: {
          success: false,
          data: null,
          message: 'Action is not allowed while the order is CONFIRMED',
          code: 'ORDER_INVALID_TRANSITION',
        },
      },
    }),
  );

// shopId lấy qua @ShopOwnerContext() (do ShopOwnerGuard resolve sẵn) chứ không qua @Param('shopId') nên
// Swagger không tự suy ra tham số đường dẫn này — phải khai tay (cùng lý do VoucherController).
const SHOP_ID_PARAM = {
  name: 'shopId',
  description: 'Id của shop mình sở hữu',
  example: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
};

// Đơn hàng của shop mình (Week8.md 2.5 đọc, 2.6 hành động xác nhận/đóng gói/giao/từ chối). ShopOwnerGuard xác nhận shop thuộc người gọi (403 nếu không, 404 nếu shop không tồn tại) —
// KHÔNG kiểm trạng thái shop: shop bị khoá (SUSPENDED) vẫn xử lý được đơn đã có (Week8.md 1.8).
// Không có prefix chung ở @Controller() vì path nằm dưới shops/:shopId (cùng VoucherController).
@ApiTags('seller-orders')
@Controller()
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải chủ shop',
  schema: { example: errorExample('Not the shop owner') },
})
export class SellerOrderController {
  constructor(
    private readonly orderQueryService: OrderQueryService,
    private readonly orderActionService: OrderActionService,
  ) {}

  @Get('shops/:shopId/orders')
  @ApiParam(SHOP_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Danh sách đơn của shop mình — chỉ đơn đã thanh toán/đã đặt COD (không có đơn chưa thanh toán), lọc theo tab, phân trang',
  })
  @ApiQuery({
    name: 'tab',
    required: false,
    enum: sellerOrderTabSchema.options,
    description:
      'Nhóm trạng thái; bỏ trống = tất cả. KHÔNG có awaiting-payment (đơn chưa thanh toán không lộ cho Seller)',
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
          items: [SELLER_ORDER_LIST_ITEM_EXAMPLE],
          total: 1,
          page: 1,
          limit: 10,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Query không hợp lệ (tab lạ hoặc awaiting-payment, limit > 50...)',
    schema: {
      example: errorExample(
        "tab: Invalid enum value. Expected 'pending' | 'processing' | 'shipping' | 'completed' | 'cancelled', received 'awaiting-payment'",
      ),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại',
    schema: { example: errorExample('Shop not found') },
  })
  list(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Query(new ZodValidationPipe(sellerOrderListQuerySchema))
    query: SellerOrderListQuery,
  ) {
    return this.orderQueryService.listForSeller(shopId, query);
  }

  @Get('shops/:shopId/orders/:orderId')
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'ID đơn hàng' })
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Chi tiết 1 đơn của shop mình — người nhận, dòng hàng lúc đặt, tiền, vận chuyển, timeline',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: SELLER_ORDER_DETAIL_EXAMPLE } },
  })
  @ApiResponse({
    status: 404,
    description:
      'Shop không tồn tại; hoặc đơn không tồn tại / thuộc shop khác / chưa thanh toán (không phân biệt)',
    schema: { example: ORDER_NOT_FOUND_EXAMPLE },
  })
  getOne(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
  ) {
    return this.orderQueryService.getForSeller(shopId, orderId);
  }
  // Hành động trả lại CHI TIẾT đơn mới nhất (đọc lại sau khi commit). Không kiểm trạng thái shop: shop bị
  // khoá tạm vẫn xử lý được đơn đã có (Week8.md 1.8).
  @Post('shops/:shopId/orders/:orderId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'ID đơn hàng' })
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Xác nhận đơn (PENDING → CONFIRMED)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_ORDER_DETAIL_EXAMPLE,
          status: 'CONFIRMED',
          canConfirm: false,
          canPack: true,
        },
      },
    },
  })
  @ApiActionErrors()
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
  ) {
    await this.orderActionService.confirm(shopId, user.userId, orderId);
    return this.orderQueryService.getForSeller(shopId, orderId);
  }

  @Post('shops/:shopId/orders/:orderId/pack')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'ID đơn hàng' })
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Đóng gói đơn (CONFIRMED → PACKED)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_ORDER_DETAIL_EXAMPLE,
          status: 'PACKED',
          canConfirm: false,
          canShip: true,
        },
      },
    },
  })
  @ApiActionErrors()
  async pack(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
  ) {
    await this.orderActionService.pack(shopId, user.userId, orderId);
    return this.orderQueryService.getForSeller(shopId, orderId);
  }

  @Post('shops/:shopId/orders/:orderId/ship')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'ID đơn hàng' })
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Giao hàng (PACKED → SHIPPING), kèm đơn vị vận chuyển / mã vận đơn nhập tay (cả 2 tuỳ chọn)',
  })
  @ApiBody({
    required: false,
    schema: { example: { carrier: 'GHN', trackingCode: 'GHN123456789' } },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_ORDER_DETAIL_EXAMPLE,
          status: 'SHIPPING',
          carrier: 'GHN',
          trackingCode: 'GHN123456789',
          canShip: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'carrier/trackingCode quá dài (tối đa 100 ký tự)',
    schema: {
      example: errorExample('carrier: order.validationCarrierTooLong'),
    },
  })
  @ApiActionErrors()
  async ship(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default {} vì cả 2 field đều tuỳ chọn.
    @Body(new ZodValidationPipe(shipOrderSchema.default({})))
    body: ShipOrderInput,
  ) {
    await this.orderActionService.ship(shopId, user.userId, orderId, body);
    return this.orderQueryService.getForSeller(shopId, orderId);
  }

  @Post('shops/:shopId/orders/:orderId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'ID đơn hàng' })
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Từ chối đơn COD chờ xác nhận (PENDING → CANCELLED, hoàn kho) — lý do bắt buộc. Đơn đã thanh toán online chưa từ chối được (hoàn tiền: Tuần 9)',
  })
  @ApiBody({ schema: { example: { reason: 'Hết hàng' } } })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_ORDER_DETAIL_EXAMPLE,
          status: 'CANCELLED',
          paymentMethod: 'COD',
          canConfirm: false,
          canReject: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu lý do hoặc lý do quá dài (tối đa 500 ký tự)',
    schema: { example: errorExample('reason: order.validationReasonRequired') },
  })
  @ApiActionErrors()
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(rejectOrderSchema)) body: RejectOrderInput,
  ) {
    await this.orderActionService.reject(
      shopId,
      user.userId,
      orderId,
      body.reason,
    );
    return this.orderQueryService.getForSeller(shopId, orderId);
  }
}
