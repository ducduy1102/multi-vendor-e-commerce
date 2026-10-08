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
  approveRefundRequestSchema,
  refundRequestStatusSchema,
  rejectRefundRequestSchema,
  sellerRefundRequestListQuerySchema,
  type ApproveRefundRequestInput,
  type RejectRefundRequestInput,
  type SellerRefundRequestListQuery,
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
import { OrderQueryService } from './order-query.service';
import {
  SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE,
  SHOP_ID_PARAM,
} from './order-swagger-examples';
import { RefundRequestActionService } from './refund-request-action.service';

const REQUEST_ID_PARAM = { name: 'id', description: 'ID yêu cầu' };

const REQUEST_NOT_FOUND = errorExample('Refund request not found', {
  code: 'REFUND_REQUEST_NOT_FOUND',
});

// Hàng chờ yêu cầu hủy/trả hàng của shop mình (Week9.md 2.7). ShopOwnerGuard xác nhận shop thuộc người gọi
// (403 nếu không, 404 nếu shop không tồn tại) — KHÔNG kiểm trạng thái shop: shop bị khoá tạm vẫn xử lý được yêu cầu
// của đơn đã có (cùng SellerOrderController). Chỉ thấy yêu cầu của đơn Seller được thấy; yêu cầu đã rút không hiện.
// Hành động trả lại YÊU CẦU mới nhất (đọc lại sau khi commit).
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
export class SellerRefundRequestController {
  constructor(
    private readonly orderQueryService: OrderQueryService,
    private readonly refundRequestActionService: RefundRequestActionService,
  ) {}

  @Get('shops/:shopId/refund-requests')
  @ApiParam(SHOP_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Hàng chờ yêu cầu hủy / trả hàng của shop mình — lọc theo trạng thái, phân trang. Mỗi dòng kèm lý do của người mua, dòng thời gian (không định danh), cờ `canApprove`/`canReject` và tóm tắt đơn. Yêu cầu "chờ shop trả lời" xếp cũ nhất trước (hạn phản hồi sớm nhất lên đầu), các bộ lọc khác mới nhất trước',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: refundRequestStatusSchema.exclude(['WITHDRAWN']).options,
    description:
      'Bỏ trống = mọi yêu cầu chưa rút. Yêu cầu đã rút (WITHDRAWN) không bao giờ hiện cho seller',
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
          items: [SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE],
          total: 1,
          page: 1,
          limit: 10,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ hoặc WITHDRAWN, limit > 50...)',
    schema: {
      example: errorExample(
        "status: Invalid enum value. Expected 'PENDING_SELLER' | 'APPROVED' | 'REJECTED_BY_SELLER' | 'ESCALATED' | 'REJECTED', received 'WITHDRAWN'",
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
    @Query(new ZodValidationPipe(sellerRefundRequestListQuerySchema))
    query: SellerRefundRequestListQuery,
  ) {
    return this.orderQueryService.listRefundRequestsForSeller(shopId, query);
  }

  @Post('shops/:shopId/refund-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam(REQUEST_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Duyệt yêu cầu. Yêu cầu HỦY ⇒ hủy đơn (cộng lại kho, trả voucher nếu hết đơn hưởng giảm, hoàn tiền tự động nếu đã thanh toán online); yêu cầu TRẢ HÀNG ⇒ đơn → REFUNDED (hoàn tiền nếu đã thanh toán online, không cộng kho). Cũng duyệt được yêu cầu HỦY đã lên sàn (seller nhượng bộ). Ghi chú tuỳ chọn, người mua đọc được',
  })
  @ApiBody({ required: false, schema: { example: { note: 'Đồng ý hủy đơn' } } })
  @ApiResponse({
    status: 200,
    description:
      'Yêu cầu sau khi duyệt (status APPROVED, đơn đã CANCELLED/REFUNDED)',
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE,
          status: 'APPROVED',
          canApprove: false,
          canReject: false,
          order: {
            ...SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE.order,
            status: 'CANCELLED',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Ghi chú quá dài (tối đa 500 ký tự)',
    schema: {
      example: errorExample('note: order.validationReasonTooLong'),
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Shop không tồn tại; hoặc yêu cầu không tồn tại / thuộc shop khác / của đơn bị ẩn / đã rút — không phân biệt',
    schema: { example: REQUEST_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_INVALID_TRANSITION = yêu cầu không còn ở trạng thái duyệt được (đã xử lý, hoặc yêu cầu TRẢ HÀNG đã lên sàn — Admin quyết định) / người mua vừa rút; ORDER_INVALID_TRANSITION | ORDER_ALREADY_CHANGED = đơn không còn ở trạng thái hợp lệ; PAYMENT_NOT_REFUNDABLE = thanh toán không còn gì để hoàn',
    schema: {
      example: errorExample(
        'Cannot change refund request status from APPROVED to APPROVED',
        { code: 'REFUND_REQUEST_INVALID_TRANSITION' },
      ),
    },
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default {} vì ghi chú tuỳ chọn.
    @Body(new ZodValidationPipe(approveRefundRequestSchema.default({})))
    body: ApproveRefundRequestInput,
  ) {
    await this.refundRequestActionService.approveForSeller(
      shopId,
      user.userId,
      id,
      body.note,
    );
    return this.orderQueryService.getRefundRequestForSeller(shopId, id);
  }

  @Post('shops/:shopId/refund-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam(SHOP_ID_PARAM)
  @ApiParam(REQUEST_ID_PARAM)
  @UseGuards(JwtAuthGuard, ShopOwnerGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Từ chối yêu cầu đang chờ shop trả lời — ghi chú BẮT BUỘC (người mua đọc được lý do). Đơn giữ nguyên trạng thái; người mua có thể khiếu nại lên sàn trong REFUND_ESCALATE_DAYS (mặc định 3 ngày)',
  })
  @ApiBody({
    schema: { example: { note: 'Hàng đã đóng gói và bàn giao vận chuyển' } },
  })
  @ApiResponse({
    status: 200,
    description: 'Yêu cầu sau khi từ chối (status REJECTED_BY_SELLER)',
    schema: {
      example: {
        success: true,
        data: {
          ...SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE,
          status: 'REJECTED_BY_SELLER',
          canApprove: false,
          canReject: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu ghi chú hoặc ghi chú quá dài (tối đa 500 ký tự)',
    schema: {
      example: errorExample('note: order.validationReasonRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Shop không tồn tại; hoặc yêu cầu không tồn tại / thuộc shop khác / của đơn bị ẩn / đã rút — không phân biệt',
    schema: { example: REQUEST_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_INVALID_TRANSITION = yêu cầu không còn chờ shop trả lời (đã xử lý / đã lên sàn / người mua vừa rút)',
    schema: {
      example: errorExample(
        'Cannot change refund request status from APPROVED to REJECTED_BY_SELLER',
        { code: 'REFUND_REQUEST_INVALID_TRANSITION' },
      ),
    },
  })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default ghi chú rỗng để lỗi báo theo field `note`
    // (giống gửi `{}`) thay vì "value: Required". Ghi chú vẫn BẮT BUỘC (rỗng bị từ chối).
    @Body(
      new ZodValidationPipe(rejectRefundRequestSchema.default({ note: '' })),
    )
    body: RejectRefundRequestInput,
  ) {
    await this.refundRequestActionService.rejectForSeller(
      shopId,
      user.userId,
      id,
      body.note,
    );
    return this.orderQueryService.getRefundRequestForSeller(shopId, id);
  }
}
