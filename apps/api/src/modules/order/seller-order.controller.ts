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
  sellerOrderListQuerySchema,
  sellerOrderTabSchema,
  type SellerOrderListQuery,
} from '@ecommerce/types';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
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

// shopId lấy qua @ShopOwnerContext() (do ShopOwnerGuard resolve sẵn) chứ không qua @Param('shopId') nên
// Swagger không tự suy ra tham số đường dẫn này — phải khai tay (cùng lý do VoucherController).
const SHOP_ID_PARAM = {
  name: 'shopId',
  description: 'Id của shop mình sở hữu',
  example: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
};

// Đơn hàng của shop mình (Week8.md 2.5). Chỉ có đọc; hành động (xác nhận/đóng gói/giao/từ chối) thêm
// ở 2.6. ShopOwnerGuard xác nhận shop thuộc người gọi (403 nếu không, 404 nếu shop không tồn tại) —
// KHÔNG kiểm trạng thái shop: shop bị khoá (SUSPENDED) vẫn xử lý được đơn đã có (Week8.md 1.8).
// Không có prefix chung ở @Controller() vì path nằm dưới shops/:shopId (cùng VoucherController).
@ApiTags('seller-orders')
@Controller()
export class SellerOrderController {
  constructor(private readonly orderQueryService: OrderQueryService) {}

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
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({ status: 404, description: 'Shop không tồn tại' })
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
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không phải chủ shop' })
  @ApiResponse({
    status: 404,
    description:
      'Shop không tồn tại; hoặc đơn không tồn tại / thuộc shop khác / chưa thanh toán (không phân biệt)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      },
    },
  })
  getOne(
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('orderId') orderId: string,
  ) {
    return this.orderQueryService.getForSeller(shopId, orderId);
  }
}
