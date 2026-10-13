import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
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
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { CheckoutService } from './checkout.service';
import {
  idempotencyKeySchema,
  placeOrderSchema,
  previewCheckoutSchema,
  type PlaceOrderDto,
  type PreviewCheckoutDto,
} from './dto/checkout.dto';

const CHECKOUT_PREVIEW_EXAMPLE = {
  orders: [
    {
      shopId: 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003',
      shopName: 'Shop Áo Xinh',
      shopSlug: 'shop-ao-xinh',
      items: [],
      subtotal: '300000',
      shippingFee: '16500',
      discountAmount: '20000',
      total: '296500',
    },
  ],
  subtotal: '300000',
  shippingTotal: '16500',
  discountTotal: '20000',
  grandTotal: '296500',
  discount: { code: 'SALE10', shopId: null, amount: '20000' },
  needsAddress: false,
  paymentMethods: [{ method: 'VNPAY', available: true }],
  excludedItems: [],
  blockingIssues: [],
  canPlaceOrder: true,
};

const CHECKOUT_GROUP_EXAMPLE = {
  id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  status: 'AWAITING_PAYMENT',
  canRetry: true,
  expiresAt: '2026-09-27T04:15:00.000Z',
  createdAt: '2026-09-27T04:00:00.000Z',
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  latestPaymentStatus: 'PENDING',
  orders: [
    {
      id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
      shopId: 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003',
      shopName: 'Shop Áo Xinh',
      status: 'AWAITING_PAYMENT',
      subtotal: '300000',
      discountAmount: '0',
      shippingFee: '20000',
      totalAmount: '320000',
      items: [],
    },
  ],
};

const CHECKOUT_RESULT_EXAMPLE = {
  checkoutGroupId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  orders: [
    {
      id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
      shopId: 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003',
      status: 'AWAITING_PAYMENT',
      totalAmount: '320000',
    },
  ],
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  expiresAt: '2026-09-27T04:00:00.000Z',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...',
};

// Route chốt ở Week7.md 1.14: POST /checkout, POST /checkout/preview (2.7b),
// GET /checkout/groups/:groupId, POST /checkout/groups/:groupId/pay (2.9).
// `/addresses` có controller riêng cùng module (2.6).
@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  // Xem trước trước khi đặt hàng (2.7b) — chỉ cần đăng nhập, KHÔNG cần EmailVerifiedGuard vì không
  // ghi gì. Không tạo resource nên 200, không phải 201 mặc định của @Post().
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Xem trước từng đơn (theo shop) trước khi đặt hàng — phí ship/giảm giá/tổng; không ghi DB, không giữ chỗ tồn kho',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: CHECKOUT_PREVIEW_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description: 'Giỏ rỗng/không còn item khả dụng',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Cart has no purchasable items',
        code: 'NO_PURCHASABLE_ITEMS',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description:
      'Địa chỉ không tồn tại/không phải của bạn (không có code), hoặc mã voucher không tồn tại (code: VOUCHER_NOT_FOUND)',
    examples: {
      addressNotFound: {
        summary: 'Address not found',
        value: { success: false, data: null, message: 'Address not found' },
      },
      voucherNotFound: {
        summary: 'VOUCHER_NOT_FOUND',
        value: {
          success: false,
          data: null,
          message: 'Voucher not found',
          code: 'VOUCHER_NOT_FOUND',
        },
      },
    },
  })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(previewCheckoutSchema))
    dto: PreviewCheckoutDto,
  ) {
    return this.checkoutService.preview(user.userId, dto);
  }

  // Bắt buộc đăng nhập + đã xác thực email (Week7.md 1.2) — check ở route-level qua guard, không
  // check lại trong service.
  @Post()
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Đặt hàng từ giỏ hiện tại — tách N Order theo shop, 1 Payment chung. paymentMethod VNPAY/MOMO: đơn AWAITING_PAYMENT giữ chỗ kho, trả paymentUrl để chuyển sang cổng. paymentMethod COD: đơn vào thẳng PENDING, kho TRỪ NGAY, không có paymentUrl và expiresAt = null (thu tiền khi nhận hàng)',
  })
  // Tên viết thường khớp tham số @Headers('idempotency-key') mà Swagger tự suy ra — khác chữ hoa
  // thường thì hiện thành 2 ô header riêng cho cùng 1 header.
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description:
      'UUID do FE sinh mỗi phiên đặt hàng; gọi lại cùng key trả đúng nhóm đã tạo thay vì đặt trùng (kể cả khi body khác — lời nhắn mới không ghi đè lời nhắn của đơn đã tạo)',
  })
  @ApiBody({
    description:
      '`shopNotes` (tuỳ chọn): lời nhắn cho từng shop, khoá là shopId, tối đa 500 ký tự mỗi lời nhắn, văn bản thuần (trim hai đầu; mục rỗng bị bỏ). shopId không có trong giỏ lúc đặt bị bỏ qua, không báo lỗi. Mỗi shop chỉ thấy lời nhắn của đơn mình.',
    examples: {
      withShopNotes: {
        summary: 'Giỏ 2 shop, mỗi shop một lời nhắn',
        value: {
          addressId: 'd1b2c3d4-1234-4a5b-8c9d-abcdef000004',
          paymentMethod: 'COD',
          voucherCode: 'GIAM50K',
          expectedTotal: 320000,
          shopNotes: {
            'c1b2c3d4-1234-4a5b-8c9d-abcdef000003':
              'Giao giờ hành chính, gọi trước khi giao nhé',
            'c1b2c3d4-1234-4a5b-8c9d-abcdef000009': 'Gói quà giúp mình',
          },
        },
      },
      withoutShopNotes: {
        summary: 'Không có lời nhắn',
        value: {
          addressId: 'd1b2c3d4-1234-4a5b-8c9d-abcdef000004',
          paymentMethod: 'VNPAY',
          expectedTotal: 320000,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    examples: {
      online: {
        summary: 'VNPAY/MOMO — chờ thanh toán',
        value: { success: true, data: CHECKOUT_RESULT_EXAMPLE },
      },
      cod: {
        summary: 'COD — không cổng, không hạn thanh toán',
        value: {
          success: true,
          data: {
            ...CHECKOUT_RESULT_EXAMPLE,
            orders: [
              { ...CHECKOUT_RESULT_EXAMPLE.orders[0], status: 'PENDING' },
            ],
            paymentMethod: 'COD',
            expiresAt: null,
            paymentUrl: null,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Giỏ rỗng/không còn item khả dụng, thiếu/sai expectedTotal, hoặc lời nhắn cho shop quá 500 ký tự',
    examples: {
      noPurchasableItems: {
        summary: 'NO_PURCHASABLE_ITEMS',
        value: {
          success: false,
          data: null,
          message: 'Cart has no purchasable items',
          code: 'NO_PURCHASABLE_ITEMS',
        },
      },
      validationError: {
        summary: 'Thiếu/sai expectedTotal (lỗi validate Zod, không có code)',
        value: {
          success: false,
          data: null,
          message: 'expectedTotal: checkout.validationExpectedTotalInvalid',
        },
      },
      noteTooLong: {
        summary:
          'Lời nhắn cho shop quá 500 ký tự (lỗi validate Zod, không có code)',
        value: {
          success: false,
          data: null,
          message:
            'shopNotes.c1b2c3d4-1234-4a5b-8c9d-abcdef000003: checkout.validationNoteTooLong',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 403,
    description: 'Email chưa xác thực',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'EMAIL_NOT_VERIFIED',
        code: 'EMAIL_NOT_VERIFIED',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Địa chỉ không tồn tại hoặc không phải của bạn (không có code)',
    schema: {
      example: { success: false, data: null, message: 'Address not found' },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'OUT_OF_STOCK / PRICE_CHANGED / CART_CHANGED / TOO_MANY_PENDING_CHECKOUTS / PAYMENT_METHOD_UNAVAILABLE (xem code)',
    examples: {
      OUT_OF_STOCK: {
        summary: 'OUT_OF_STOCK',
        value: {
          success: false,
          data: null,
          message: 'Insufficient stock for one or more items',
          code: 'OUT_OF_STOCK',
          details: {
            items: [
              {
                productVariantId: 'c4d5e6f7-1234-4a5b-8c9d-abcdef654321',
                productName: 'Áo thun nam',
                variantLabel: 'Đỏ / M',
                available: 1,
              },
            ],
          },
        },
      },
      PRICE_CHANGED: {
        summary: 'PRICE_CHANGED',
        value: {
          success: false,
          data: null,
          message: 'Price changed since preview',
          code: 'PRICE_CHANGED',
          details: { expectedTotal: 300000, currentTotal: 320000 },
        },
      },
      CART_CHANGED: {
        summary: 'CART_CHANGED',
        value: {
          success: false,
          data: null,
          message: 'Cart changed since it was read',
          code: 'CART_CHANGED',
        },
      },
      TOO_MANY_PENDING_CHECKOUTS: {
        summary: 'TOO_MANY_PENDING_CHECKOUTS',
        value: {
          success: false,
          data: null,
          message: 'Too many pending checkouts',
          code: 'TOO_MANY_PENDING_CHECKOUTS',
          details: {
            pendingGroupIds: ['a1b2c3d4-1234-4a5b-8c9d-abcdef000001'],
          },
        },
      },
      PAYMENT_METHOD_UNAVAILABLE: {
        summary: 'PAYMENT_METHOD_UNAVAILABLE',
        value: {
          success: false,
          data: null,
          message: 'Payment method MOMO is not available',
          code: 'PAYMENT_METHOD_UNAVAILABLE',
          details: { method: 'MOMO', reason: 'NOT_CONFIGURED' },
        },
      },
    },
  })
  async placeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(placeOrderSchema)) dto: PlaceOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    const idempotencyKey = this.parseIdempotencyKey(idempotencyKeyHeader);
    return this.checkoutService.placeOrder(user.userId, dto, idempotencyKey);
  }

  // Chỉ chủ nhóm xem được — người khác coi như không tồn tại (404, cùng luật /addresses).
  @Get('groups/:groupId')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Trạng thái 1 nhóm thanh toán + danh sách đơn — cho trang /checkout/result',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: CHECKOUT_GROUP_EXAMPLE } },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Nhóm không tồn tại hoặc không phải của bạn',
  })
  async getCheckoutGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ) {
    return this.checkoutService.getCheckoutGroup(user.userId, groupId);
  }

  // "Tiếp tục thanh toán" / thanh toán lại (1.11 (4b), 1.4) — trả lại payUrl đã lưu nếu còn dùng
  // được (200), hoặc tạo lần thử mới (201, khớp default @Post() — route chốt ở 1.14). Status ĐỘNG
  // theo `created` nên dùng @Res({passthrough:true}) tự set thay vì @HttpCode() tĩnh.
  @Post('groups/:groupId/pay')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Tiếp tục thanh toán / thanh toán lại — trả payUrl đã lưu nếu còn dùng được, hoặc tạo lần thử mới',
  })
  @ApiResponse({
    status: 201,
    description: 'Vừa tạo lần thử thanh toán MỚI (txnRef mới)',
    schema: {
      example: {
        success: true,
        data: {
          paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...',
          expiresAt: '2026-09-27T04:15:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Trả lại payUrl đã lưu của lần thử còn hiệu lực (không tạo lần thử mới)',
    schema: {
      example: {
        success: true,
        data: {
          paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...',
          expiresAt: '2026-09-27T04:15:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 404,
    description: 'Nhóm không tồn tại hoặc không phải của bạn',
  })
  @ApiResponse({
    status: 409,
    description:
      'PAYMENT_RETRY_NOT_ALLOWED (đã trả tiền / đã hết hạn giữ / nhóm COD không có cổng để thử lại) / PAYMENT_METHOD_UNAVAILABLE',
    examples: {
      ALREADY_PAID: {
        summary: 'PAYMENT_RETRY_NOT_ALLOWED — ALREADY_PAID',
        value: {
          success: false,
          data: null,
          message: 'This checkout group has already been paid',
          code: 'PAYMENT_RETRY_NOT_ALLOWED',
          details: { reason: 'ALREADY_PAID' },
        },
      },
      HOLD_EXPIRED: {
        summary: 'PAYMENT_RETRY_NOT_ALLOWED — HOLD_EXPIRED',
        value: {
          success: false,
          data: null,
          message: 'The payment hold for this checkout group has expired',
          code: 'PAYMENT_RETRY_NOT_ALLOWED',
          details: { reason: 'HOLD_EXPIRED' },
        },
      },
      NOT_ONLINE_PAYMENT: {
        summary: 'PAYMENT_RETRY_NOT_ALLOWED — NOT_ONLINE_PAYMENT (nhóm COD)',
        value: {
          success: false,
          data: null,
          message: 'Cash on delivery orders have no online payment to retry',
          code: 'PAYMENT_RETRY_NOT_ALLOWED',
          details: { reason: 'NOT_ONLINE_PAYMENT' },
        },
      },
      PAYMENT_METHOD_UNAVAILABLE: {
        summary: 'PAYMENT_METHOD_UNAVAILABLE',
        value: {
          success: false,
          data: null,
          message: 'Payment method MOMO is not configured',
          code: 'PAYMENT_METHOD_UNAVAILABLE',
          details: { method: 'MOMO', reason: 'NOT_CONFIGURED' },
        },
      },
    },
  })
  async retryPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { paymentUrl, expiresAt, created } =
      await this.checkoutService.retryPayment(user.userId, groupId);
    // 201 khi vừa tạo lần thử mới, 200 khi trả lại payUrl đã lưu của lần thử còn hiệu lực
    // (route chốt ở Week7.md 1.14) — `created` không lộ ra body, chỉ payAttemptResultSchema.
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { paymentUrl, expiresAt };
  }

  private parseIdempotencyKey(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const result = idempotencyKeySchema.safeParse(raw);
    if (!result.success) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    return result.data;
  }
  // Buyer hủy cả nhóm CHƯA thanh toán (Week8.md 2.6) — logic hủy do module order làm (reclaimCheckoutGroup
  // với actor BUYER), route đặt ở checkout như các route nhóm khác. Idempotent: nhóm đã hủy trả lại
  // trạng thái hiện tại. Trả cùng hình dạng GET /checkout/groups/:groupId.
  @Post('groups/:groupId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Hủy cả nhóm đơn CHƯA thanh toán — nhả giữ chỗ tồn kho và lượt voucher (idempotent)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trạng thái nhóm sau khi hủy (status CANCELLED)',
    schema: {
      example: {
        success: true,
        data: {
          ...CHECKOUT_GROUP_EXAMPLE,
          status: 'CANCELLED',
          canRetry: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 404,
    description: 'Nhóm không tồn tại hoặc không phải của bạn',
    schema: { example: errorExample('Checkout group not found') },
  })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_ALREADY_CHANGED = nhóm vừa được thanh toán (đơn nay hủy từng đơn kèm hoàn tiền); ORDER_INVALID_TRANSITION = nhóm không còn đơn chờ thanh toán',
    schema: {
      example: {
        success: false,
        data: null,
        message:
          'This checkout group has already been paid — cancel the individual orders instead',
        code: 'ORDER_ALREADY_CHANGED',
      },
    },
  })
  cancelGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ) {
    return this.checkoutService.cancelCheckoutGroup(user.userId, groupId);
  }
}
