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
import { Role } from '@prisma/client';
import {
  adminDecideRefundRequestSchema,
  adminMarkRefundCompletedSchema,
  adminRefundListFilterSchema,
  adminRefundListQuerySchema,
  adminRefundablePaymentListQuerySchema,
  adminRefundPaymentSchema,
  adminRefundRequestListQuerySchema,
  refundRequestStatusSchema,
  type AdminDecideRefundRequestInput,
  type AdminMarkRefundCompletedInput,
  type AdminRefundListQuery,
  type AdminRefundablePaymentListQuery,
  type AdminRefundPaymentInput,
  type AdminRefundRequestListQuery,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  FORBIDDEN_ROLE_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import type { OrderActor } from '../order/order-status.service';
import { RefundQueryService } from '../order/refund-query.service';
import { RefundRequestActionService } from '../order/refund-request-action.service';
import { RefundService } from '../order/refund.service';
import {
  ADMIN_REFUND_EXAMPLE,
  ADMIN_REFUND_REQUEST_EXAMPLE,
  ADMIN_REFUNDABLE_PAYMENT_EXAMPLE,
  PAYMENT_ID_PARAM,
  REFUND_ID_PARAM,
  REFUND_REQUEST_ID_PARAM,
} from './admin-swagger-examples';

const REQUEST_NOT_FOUND = errorExample('Refund request not found', {
  code: 'REFUND_REQUEST_NOT_FOUND',
});
const REFUND_NOT_FOUND = errorExample('Refund not found', {
  code: 'PAYMENT_REFUND_NOT_FOUND',
});

const adminActor = (admin: AuthenticatedUser): OrderActor => ({
  type: 'ADMIN',
  id: admin.userId,
});

// Xử lý tiền hoàn toàn sàn — chỉ role ADMIN (Week9.md 1.9, 2.9). Quyền thật nằm ở đây (BE); guard FE chỉ để
// điều hướng. Controller chỉ nhận request, gọi service của module `order` (qua OrderModule) rồi đọc lại dòng
// mới nhất để trả — không có logic nghiệp vụ ở đây. Admin không bị giới hạn theo shop như seller.
@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải ADMIN',
  schema: { example: FORBIDDEN_ROLE_EXAMPLE },
})
export class AdminRefundController {
  constructor(
    private readonly refundQueryService: RefundQueryService,
    private readonly refundRequestActionService: RefundRequestActionService,
    private readonly refundService: RefundService,
  ) {}

  // --- Yêu cầu hủy / trả hàng (khiếu nại) ------------------------------------------------------

  @Get('refund-requests')
  @ApiOperation({
    summary:
      'Hàng chờ yêu cầu hủy / trả hàng theo trạng thái (mặc định ESCALATED = người mua khiếu nại lên sàn), kèm người mua, shop, tóm tắt đơn, dòng thời gian và cờ `canApprove`/`canReject` — chỉ ADMIN',
    description:
      'Hàng chờ (PENDING_SELLER, ESCALATED) xếp cũ nhất trước theo lúc vào trạng thái đó; các trạng thái đã xong xếp mới nhất trước. ' +
      'Admin xem được mọi trạng thái, kể cả yêu cầu đã rút.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: refundRequestStatusSchema.options,
    description: 'Mặc định ESCALATED',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          items: [ADMIN_REFUND_REQUEST_EXAMPLE],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ, limit > 50...)',
    schema: {
      example: errorExample(
        "status: Invalid enum value. Expected 'PENDING_SELLER' | 'APPROVED' | 'REJECTED_BY_SELLER' | 'ESCALATED' | 'REJECTED' | 'WITHDRAWN', received 'bad'",
      ),
    },
  })
  listRefundRequests(
    @Query(new ZodValidationPipe(adminRefundRequestListQuerySchema))
    query: AdminRefundRequestListQuery,
  ) {
    return this.refundQueryService.listRefundRequests(query);
  }

  @Post('refund-requests/:id/decide')
  @HttpCode(HttpStatus.OK)
  @ApiParam(REFUND_REQUEST_ID_PARAM)
  @ApiOperation({
    summary:
      'Quyết định yêu cầu: APPROVE ⇒ hủy đơn / hoàn đơn (hoàn tiền tự động nếu đã thanh toán online), REJECT ⇒ từ chối (ghi chú bắt buộc). Quyết định được cả yêu cầu đã lên sàn lẫn yêu cầu còn chờ seller — chỉ ADMIN',
    description:
      'APPROVE yêu cầu HỦY: hủy đơn, cộng lại kho, trả voucher nếu hết đơn hưởng giảm. APPROVE yêu cầu TRẢ HÀNG: đơn COMPLETED → REFUNDED, không cộng kho. ' +
      'Khoản hoàn tiền có thể ở PENDING/FAILED nếu cổng chậm hoặc lỗi — xử lý tiếp ở /admin/refunds. Ghi chú được ghi vào dòng thời gian, người mua và seller đọc được.',
  })
  @ApiBody({
    schema: {
      example: { decision: 'REJECT', note: 'Ảnh không cho thấy lỗi như mô tả' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Yêu cầu sau khi quyết định (đọc lại sau khi commit)',
    schema: {
      example: {
        success: true,
        data: {
          ...ADMIN_REFUND_REQUEST_EXAMPLE,
          status: 'REJECTED',
          canApprove: false,
          canReject: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (decision lạ, thiếu ghi chú khi từ chối, ghi chú > 500 ký tự)',
    schema: {
      example: errorExample('note: order.validationReasonRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Yêu cầu không tồn tại',
    schema: { example: REQUEST_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_REQUEST_INVALID_TRANSITION = yêu cầu không còn ở trạng thái quyết định được (đã xử lý / chưa lên sàn / người mua vừa rút); ORDER_INVALID_TRANSITION | ORDER_ALREADY_CHANGED = đơn không còn ở trạng thái hợp lệ; PAYMENT_NOT_REFUNDABLE = thanh toán không còn gì để hoàn',
    schema: {
      example: errorExample(
        'Cannot change refund request status from APPROVED to REJECTED',
        { code: 'REFUND_REQUEST_INVALID_TRANSITION' },
      ),
    },
  })
  async decide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminDecideRefundRequestSchema))
    body: AdminDecideRefundRequestInput,
  ) {
    await this.refundRequestActionService.decideForAdmin(
      admin.userId,
      id,
      body.decision,
      body.note,
    );
    return this.refundQueryService.getRefundRequest(id);
  }

  // --- Sổ cái hoàn tiền ------------------------------------------------------------------------

  @Get('refunds')
  @ApiOperation({
    summary:
      'Khoản hoàn tiền theo trạng thái (mặc định NEEDS_ACTION = FAILED + PENDING bị bỏ dở quá 5 phút — đúng tập thử lại / ghi nhận thủ công được), kèm người mua, mã giao dịch của cổng, cờ `canRetry`/`canMarkCompleted` — chỉ ADMIN',
    description:
      'Hàng chờ xếp cũ nhất trước theo lần cập nhật gần nhất; SUCCEEDED (lịch sử) mới nhất trước. PENDING gồm cả lần gọi cổng còn đang chạy (chưa thử lại được).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: adminRefundListFilterSchema.options,
    description: 'Mặc định NEEDS_ACTION',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          items: [ADMIN_REFUND_EXAMPLE],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ, limit > 50...)',
    schema: {
      example: errorExample(
        "status: Invalid enum value. Expected 'NEEDS_ACTION' | 'PENDING' | 'FAILED' | 'SUCCEEDED', received 'bad'",
      ),
    },
  })
  listRefunds(
    @Query(new ZodValidationPipe(adminRefundListQuerySchema))
    query: AdminRefundListQuery,
  ) {
    return this.refundQueryService.listRefunds(query);
  }

  @Post('refunds/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiParam(REFUND_ID_PARAM)
  @ApiOperation({
    summary:
      'Thử lại một khoản hoàn lỗi (FAILED) hoặc bị bỏ dở (PENDING quá 5 phút): gọi lại cổng bằng CÙNG dòng và CÙNG mã tham chiếu nên cổng không hoàn hai lần — chỉ ADMIN',
  })
  @ApiResponse({
    status: 200,
    description:
      'Khoản hoàn sau lần thử (SUCCEEDED, hoặc vẫn FAILED/PENDING nếu cổng lại lỗi/chậm)',
    schema: { example: { success: true, data: ADMIN_REFUND_EXAMPLE } },
  })
  @ApiResponse({
    status: 404,
    description: 'Khoản hoàn không tồn tại',
    schema: { example: REFUND_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description:
      'PAYMENT_REFUND_NOT_RETRYABLE = khoản hoàn không ở trạng thái thử lại được (đã SUCCEEDED, hoặc PENDING còn mới); PAYMENT_NOT_REFUNDABLE = thanh toán không còn để hoàn hoặc sẽ vượt số đã thu',
    schema: {
      example: errorExample(
        'Refund is not in a state that can be retried or completed manually',
        { code: 'PAYMENT_REFUND_NOT_RETRYABLE' },
      ),
    },
  })
  async retryRefund(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.refundService.retryRefund(adminActor(admin), id);
    return this.refundQueryService.getRefund(id);
  }

  @Post('refunds/:id/mark-completed')
  @HttpCode(HttpStatus.OK)
  @ApiParam(REFUND_ID_PARAM)
  @ApiOperation({
    summary:
      'Ghi nhận đã hoàn tiền thủ công ngoài hệ thống (vd trên trang merchant của cổng): SUCCEEDED với mã `MANUAL:<reference>`, cộng vào Payment.refundedAmount — chỉ ADMIN',
    description:
      'Cùng điều kiện đầu vào với retry (FAILED hoặc PENDING bị bỏ dở) để không đua với một lần gọi cổng đang chạy. Idempotent: gọi lại với cùng `reference` trả đúng kết quả cũ, không cộng tiền lần hai.',
  })
  @ApiBody({ schema: { example: { reference: 'REFUND-VNP-20261011-001' } } })
  @ApiResponse({
    status: 200,
    description: 'Khoản hoàn sau khi ghi nhận (status SUCCEEDED)',
    schema: {
      example: {
        success: true,
        data: {
          ...ADMIN_REFUND_EXAMPLE,
          status: 'SUCCEEDED',
          gatewayRef: 'MANUAL:REFUND-VNP-20261011-001',
          failureReason: null,
          canRetry: false,
          canMarkCompleted: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu mã tham chiếu hoặc mã > 100 ký tự',
    schema: {
      example: errorExample(
        'reference: admin.validationRefundReferenceRequired',
      ),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Khoản hoàn không tồn tại',
    schema: { example: REFUND_NOT_FOUND },
  })
  @ApiResponse({
    status: 409,
    description:
      'PAYMENT_REFUND_NOT_RETRYABLE = khoản hoàn đã SUCCEEDED bằng mã khác, hoặc PENDING còn mới; PAYMENT_NOT_REFUNDABLE = ghi nhận sẽ vượt số đã thu',
    schema: {
      example: errorExample(
        'Refund is not in a state that can be retried or completed manually',
        { code: 'PAYMENT_REFUND_NOT_RETRYABLE' },
      ),
    },
  })
  async markRefundCompleted(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default mã rỗng để lỗi báo theo field `reference`.
    @Body(
      new ZodValidationPipe(
        adminMarkRefundCompletedSchema.default({ reference: '' }),
      ),
    )
    body: AdminMarkRefundCompletedInput,
  ) {
    await this.refundService.markRefundCompleted(
      adminActor(admin),
      id,
      body.reference,
    );
    return this.refundQueryService.getRefund(id);
  }

  // --- Thanh toán bất thường -------------------------------------------------------------------

  @Get('refundable-payments')
  @ApiOperation({
    summary:
      'Thanh toán bất thường cần hoàn mà chưa có dòng hoàn nào: PAID_AFTER_EXPIRY (tiền đến sau khi mọi đơn của nhóm đã bị hủy) và DUPLICATE (khách thanh toán hai lần) — chỉ ADMIN',
    description:
      'Payment đã có bất kỳ dòng hoàn nào (kể cả FAILED) không hiện ở đây: xử lý bằng retry / ghi nhận thủ công trên chính dòng đó ở /admin/refunds. Cũ nhất trước.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Tối đa 50',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: {
          items: [ADMIN_REFUNDABLE_PAYMENT_EXAMPLE],
          total: 1,
          page: 1,
          limit: 20,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (limit > 50...)',
    schema: {
      example: errorExample('limit: Number must be less than or equal to 50'),
    },
  })
  listRefundablePayments(
    @Query(new ZodValidationPipe(adminRefundablePaymentListQuerySchema))
    query: AdminRefundablePaymentListQuery,
  ) {
    return this.refundQueryService.listRefundablePayments(query);
  }

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiParam(PAYMENT_ID_PARAM)
  @ApiOperation({
    summary:
      'Hoàn TOÀN BỘ một khoản thanh toán bất thường (PAID_AFTER_EXPIRY hoặc thanh toán trùng) — chỉ chuyển tiền, không cộng kho, không trả voucher — chỉ ADMIN',
    description:
      'Tạo khoản hoàn không gắn đơn nào rồi gọi cổng ngay (có giới hạn thời gian). Khoản hoàn trả về có thể đang PENDING/FAILED nếu cổng chậm hoặc lỗi — xử lý tiếp ở /admin/refunds.',
  })
  @ApiBody({
    required: false,
    schema: { example: { reason: 'Khách thanh toán hai lần' } },
  })
  @ApiResponse({
    status: 200,
    description: 'Khoản hoàn vừa tạo (order = null)',
    schema: {
      example: {
        success: true,
        data: { ...ADMIN_REFUND_EXAMPLE, order: null },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Lý do quá dài (tối đa 500 ký tự)',
    schema: { example: errorExample('reason: admin.validationReasonTooLong') },
  })
  @ApiResponse({
    status: 404,
    description: 'Thanh toán không tồn tại',
    schema: { example: errorExample('Payment not found') },
  })
  @ApiResponse({
    status: 409,
    description:
      'PAYMENT_NOT_REFUNDABLE = khoản thanh toán không bất thường (hoàn qua đơn), không ở trạng thái SUCCESS, hoặc đã có dòng hoàn',
    schema: {
      example: errorExample(
        'Only a late or duplicate payment can be refunded without an order',
        { code: 'PAYMENT_NOT_REFUNDABLE' },
      ),
    },
  })
  async refundPayment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    // Express 5: không gửi body ⇒ req.body là undefined — default {} vì lý do tuỳ chọn.
    @Body(new ZodValidationPipe(adminRefundPaymentSchema.default({})))
    body: AdminRefundPaymentInput,
  ) {
    const refund = await this.refundService.refundPayment(
      adminActor(admin),
      id,
      body.reason,
    );
    return this.refundQueryService.getRefund(refund.id);
  }
}
