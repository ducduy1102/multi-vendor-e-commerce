import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
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
import { shopStatusSchema } from '@ecommerce/types';
import type { Request } from 'express';
import { auditRequestContext } from '../../shared/audit/audit-request-context';
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
import { AdminShopOrdersService } from './admin-shop-orders.service';
import { AdminService } from './admin.service';
import {
  adminCancelShopOrdersSchema,
  type CancelShopOpenOrdersDto,
} from './dto/cancel-shop-open-orders.dto';
import {
  adminShopListQuerySchema,
  type ListShopsQueryDto,
} from './dto/list-shops-query.dto';
import {
  adminUpdateShopStatusSchema,
  type UpdateShopStatusDto,
} from './dto/update-shop-status.dto';

// "access_token" khớp ACCESS_TOKEN_COOKIE ở modules/auth/auth.constants.ts — chỉ dùng cho annotation
// Swagger nên viết literal thay vì import chéo module (rules/general.md mục 1).
const ADMIN_SHOP_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  ownerId: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
  // Suy từ ShopStatusHistory (không phải cột): lý do từ chối GẦN NHẤT và số lần chủ shop đã gửi duyệt lại.
  lastRejectionReason: null,
  resubmissionCount: 0,
};

// Khu quản trị toàn sàn — chỉ role ADMIN (Week8.md 1.8, lần đầu RolesGuard/@Roles gắn route thật).
// Quyền thật nằm ở đây (BE); guard FE chỉ để điều hướng.
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
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminShopOrdersService: AdminShopOrdersService,
  ) {}

  @Get('shops')
  @ApiOperation({
    summary:
      'Danh sách shop theo trạng thái (mặc định hàng chờ duyệt PENDING), kèm chủ shop — chỉ ADMIN',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: shopStatusSchema.options,
    description: 'Mặc định PENDING',
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
        data: { items: [ADMIN_SHOP_EXAMPLE], total: 1, page: 1, limit: 20 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query không hợp lệ (status lạ, limit > 50...)',
    schema: {
      example: errorExample(
        "status: Invalid enum value. Expected 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED', received 'bad'",
      ),
    },
  })
  listShops(
    @Query(new ZodValidationPipe(adminShopListQuerySchema))
    query: ListShopsQueryDto,
  ) {
    return this.adminService.listShops(query);
  }

  @Patch('shops/:id/status')
  @ApiOperation({
    summary:
      'Duyệt / từ chối / khoá / mở khoá shop — chỉ các cạnh PENDING→APPROVED|REJECTED, APPROVED→SUSPENDED, SUSPENDED→APPROVED',
    description:
      'Từ chối (REJECTED) và khoá (SUSPENDED) bắt buộc có `reason`; duyệt và mở khoá xoá lý do cũ ' +
      '(`reason` gửi kèm bị bỏ qua). Khoá chỉ ngừng nhận ĐƠN MỚI và ẩn sản phẩm khỏi trang công khai — ' +
      'Seller vẫn đăng nhập và xử lý đơn đã có. Sau khi đổi thành công, hệ thống gửi email báo CHỦ SHOP theo ' +
      'ngôn ngữ của họ (duyệt / từ chối kèm lý do / khoá kèm lý do / mở khoá); gửi lỗi không làm request thất bại ' +
      'và không hoàn tác việc đổi trạng thái.',
  })
  @ApiParam({ name: 'id', description: 'ID shop' })
  @ApiBody({
    schema: {
      example: { status: 'SUSPENDED', reason: 'Vi phạm chính sách hàng cấm' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Shop sau khi đổi trạng thái (kèm statusReason)',
    schema: {
      example: {
        success: true,
        data: {
          shop: {
            ...ADMIN_SHOP_EXAMPLE,
            status: 'SUSPENDED',
            statusReason: 'Vi phạm chính sách hàng cấm',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (status không phải APPROVED/REJECTED/SUSPENDED, thiếu lý do khi từ chối/khoá, lý do > 500 ký tự)',
    schema: {
      example: errorExample('reason: admin.validationReasonRequired'),
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại',
    schema: { example: errorExample('Shop not found') },
  })
  @ApiResponse({
    status: 409,
    description:
      'Shop không còn ở trạng thái cho phép chuyển (đã có người xử lý, hoặc cạnh không hợp lệ: SHOP_INVALID_TRANSITION), ' +
      'hoặc tài khoản chủ shop không còn ACTIVE khi duyệt / mở khoá (SHOP_OWNER_NOT_ACTIVE)',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Cannot change shop status from APPROVED to APPROVED',
        code: 'SHOP_INVALID_TRANSITION',
      },
    },
  })
  async updateShopStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminUpdateShopStatusSchema))
    dto: UpdateShopStatusDto,
  ) {
    const shop = await this.adminService.updateShopStatus(
      admin.userId,
      id,
      dto,
    );
    return { shop };
  }

  // POST nhưng KHÔNG tạo tài nguyên nào ⇒ 200 tường minh (mặc định của @Post là 201; Swagger @ApiResponse không tự đọc lại).
  @Post('shops/:id/cancel-open-orders')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Hủy hàng loạt các đơn CHƯA GIAO (PENDING / CONFIRMED / PACKED) của một shop đang bị khoá — chỉ ADMIN',
    description:
      'Chỉ dùng được khi shop ĐANG SUSPENDED. Hủy TUẦN TỰ từng đơn bằng đúng luồng hủy của người bán (trạng thái đơn, ' +
      'cộng lại kho, trả lượt voucher, hoàn tiền về nguồn thanh toán với đơn đã trả online) với actor ADMIN; đơn COD chỉ ' +
      'đổi trạng thái. Mỗi lần gọi xử lý tối đa 20 đơn (cũ nhất trước) — còn đơn thì `remaining > 0` và gọi lại để xử lý ' +
      'phần còn lại (idempotent: đơn đã hủy không còn được chọn). `needsManualRefund`: đơn ĐÃ hủy nhưng cổng thanh toán ' +
      'từ chối khoản hoàn (vd sandbox VNPay chỉ cho một lần hoàn mỗi giao dịch) — xử lý tiếp ở màn hoàn tiền; ' +
      '`refundsPending`: số đơn mà khoản hoàn còn chờ cổng (job tự thử lại). `failed`: đơn không hủy được kèm MÃ lỗi ' +
      '(ORDER_INVALID_TRANSITION khi đơn vừa chuyển trạng thái, ORDER_ALREADY_CHANGED, PAYMENT_NOT_REFUNDABLE, UNKNOWN). ' +
      '`reason` bắt buộc (≤ 500 ký tự), hiện trong dòng thời gian của đơn và email gửi người mua. Nhật ký quản trị ghi hai ' +
      'dòng CANCEL_SHOP_OPEN_ORDERS: STARTED (trước khi hủy; không ghi được thì không hủy) và FINISHED (kèm số đếm). ' +
      'Admin khác mở lại shop giữa chừng thì việc hủy dừng ngay.',
  })
  @ApiParam({ name: 'id', description: 'ID shop (UUID)' })
  @ApiBody({
    schema: {
      example: { reason: 'Shop bị khoá do vi phạm; hủy các đơn chưa giao.' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Kết quả của lần gọi này',
    schema: {
      example: {
        success: true,
        data: {
          cancelled: 18,
          failed: [
            {
              orderId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef123456',
              code: 'ORDER_INVALID_TRANSITION',
            },
          ],
          needsManualRefund: [
            {
              orderId: 'b2c3d4e5-1234-4a5b-8c9d-abcdef123456',
              refundId: 'c3d4e5f6-1234-4a5b-8c9d-abcdef123456',
              amount: '220000',
            },
          ],
          refundsPending: 0,
          remaining: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Body không hợp lệ (thiếu / rỗng / quá dài lý do, lý do có ký tự điều khiển)',
    schema: { example: errorExample('reason: admin.validationReasonRequired') },
  })
  @ApiResponse({
    status: 404,
    description: 'Shop không tồn tại (hoặc id sai dạng)',
    schema: { example: errorExample('Shop not found') },
  })
  @ApiResponse({
    status: 409,
    description: 'Shop không ở trạng thái SUSPENDED (SHOP_NOT_SUSPENDED)',
    schema: {
      example: {
        success: false,
        data: null,
        message:
          'Open orders can only be cancelled in bulk while the shop is suspended',
        code: 'SHOP_NOT_SUSPENDED',
      },
    },
  })
  cancelOpenOrders(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminCancelShopOrdersSchema))
    dto: CancelShopOpenOrdersDto,
    @Req() req: Request,
  ) {
    return this.adminShopOrdersService.cancelOpenOrders(
      admin.userId,
      id,
      dto,
      auditRequestContext(req),
    );
  }
}
