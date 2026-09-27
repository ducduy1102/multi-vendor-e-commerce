import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
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
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { CheckoutService } from './checkout.service';
import {
  idempotencyKeySchema,
  placeOrderSchema,
  type PlaceOrderDto,
} from './dto/checkout.dto';

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

  // Bắt buộc đăng nhập + đã xác thực email (Week7.md 1.2) — check ở route-level qua guard, không
  // check lại trong service.
  @Post()
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Đặt hàng từ giỏ hiện tại — tách N Order theo shop, 1 Payment chung',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'UUID do FE sinh mỗi phiên đặt hàng; gọi lại cùng key trả đúng nhóm đã tạo thay vì đặt trùng',
  })
  @ApiResponse({
    status: 201,
    schema: { example: { success: true, data: CHECKOUT_RESULT_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description: 'Giỏ rỗng/không còn item khả dụng, thiếu expectedTotal',
  })
  @ApiResponse({
    status: 403,
    description: 'Email chưa xác thực (code: EMAIL_NOT_VERIFIED)',
  })
  @ApiResponse({
    status: 404,
    description: 'Địa chỉ không tồn tại hoặc không phải của bạn',
  })
  @ApiResponse({
    status: 409,
    description:
      'OUT_OF_STOCK / PRICE_CHANGED / CART_CHANGED / TOO_MANY_PENDING_CHECKOUTS / PAYMENT_METHOD_UNAVAILABLE (xem code)',
  })
  async placeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(placeOrderSchema)) dto: PlaceOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    const idempotencyKey = this.parseIdempotencyKey(idempotencyKeyHeader);
    return this.checkoutService.placeOrder(user.userId, dto, idempotencyKey);
  }

  private parseIdempotencyKey(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const result = idempotencyKeySchema.safeParse(raw);
    if (!result.success) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    return result.data;
  }
}
