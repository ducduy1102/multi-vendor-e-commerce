import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import {
  ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE,
  type AdminCancelShopOrdersResult,
} from '@ecommerce/types';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import type { AuditRequestContext } from '../../shared/audit/audit-request-context';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RefundService } from '../order/refund.service';
import { isUuid } from './admin-user-id';

// Đơn "chưa giao" mà Admin được hủy hàng loạt: shop chưa xác nhận, đã xác nhận, đã đóng gói. Khớp CANCEL_PLAN.from của
// RefundService (SHIPPING trở đi không hủy được); `AWAITING_PAYMENT` bỏ qua có chủ ý — đơn chờ thanh toán chưa có tiền nào
// để hoàn và đã có job hết hạn tự giải phóng kho/voucher. Int-spec kiểm cả hai chiều (mỗi trạng thái ở đây hủy được, các
// trạng thái còn lại không bị chọn).
const OPEN_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED'];

// Mã nghiệp vụ của một lỗi (AppException) hoặc UNKNOWN cho mọi lỗi khác — không bao giờ là thông điệp gốc.
function failureCode(error: unknown): string {
  return error instanceof AppException
    ? (error as AppException).code
    : 'UNKNOWN';
}

// Hủy hàng loạt đơn chưa giao của shop đang bị khoá (Week11.md 4.1, D2). Lặp TUẦN TỰ `RefundService.cancelOrderWithRefund` với
// actor ADMIN — mỗi đơn là một transaction riêng của RefundService (khoá Payment → đơn cả nhóm → kho → voucher, kho cộng lại,
// voucher nhả, PaymentRefund tạo), nên một đơn lỗi không kéo theo các đơn khác và chạy lại chỉ xử lý phần còn lại (đơn đã hủy
// không còn được chọn). Không gom thành một transaction lớn: giữ khoá hàng chục đơn trong lúc gọi cổng thanh toán ngoài sẽ
// chặn người mua và seller khác.
//
// Nhật ký quản trị ghi HAI dòng cùng hành động: dòng `STARTED` TRƯỚC khi hủy đơn đầu tiên (fail-closed — không ghi được dấu
// vết thì không làm, vì việc này không hoàn tác được và hủy nhiều transaction nên không có một transaction duy nhất để gói
// dòng nhật ký như 3.3), và dòng `FINISHED` kèm số đếm khi xong. Dòng thứ hai lỗi chỉ ghi log, không biến một việc đã làm
// xong thành lỗi 500 (nhật ký chỉ-thêm nên không sửa được dòng đầu).
@Injectable()
export class AdminShopOrdersService {
  private readonly logger = new Logger(AdminShopOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refundService: RefundService,
    private readonly auditService: AdminAuditService,
  ) {}

  async cancelOpenOrders(
    adminId: string,
    shopId: string,
    input: { reason: string },
    context: AuditRequestContext = {},
  ): Promise<AdminCancelShopOrdersResult> {
    await this.assertShopSuspended(shopId);

    const matched = await this.countOpenOrders(shopId);
    if (matched === 0) {
      return {
        cancelled: 0,
        failed: [],
        needsManualRefund: [],
        refundsPending: 0,
        remaining: 0,
      };
    }

    await this.auditService.record(this.prisma, {
      actorId: adminId,
      action: 'CANCEL_SHOP_OPEN_ORDERS',
      targetType: 'SHOP',
      targetId: shopId,
      reason: input.reason,
      meta: { phase: 'STARTED', matched },
      ...context,
    });

    const orders = await this.prisma.order.findMany({
      where: { shopId, status: { in: OPEN_ORDER_STATUSES } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE,
      select: { id: true },
    });

    const result: AdminCancelShopOrdersResult = {
      cancelled: 0,
      failed: [],
      needsManualRefund: [],
      refundsPending: 0,
      remaining: 0,
    };
    const actor = { type: 'ADMIN', id: adminId } as const;

    for (const { id: orderId } of orders) {
      // Admin khác mở lại shop giữa chừng ⇒ dừng ngay: đơn còn lại lại là việc bình thường của chủ shop.
      if (!(await this.isSuspended(shopId))) break;

      try {
        const outcome = await this.refundService.cancelOrderWithRefund(
          actor,
          orderId,
          { reason: input.reason },
        );
        result.cancelled += 1;
        if (outcome.refund?.status === 'FAILED') {
          result.needsManualRefund.push({
            orderId,
            refundId: outcome.refund.id,
            amount: outcome.refund.amount,
          });
        } else if (outcome.refund?.status === 'PENDING') {
          result.refundsPending += 1;
        }
      } catch (error) {
        // Chỉ mã nghiệp vụ ra response; thông điệp gốc có thể mang dữ liệu nội bộ nên không vào response lẫn log.
        const code = failureCode(error);
        result.failed.push({ orderId, code });
        this.logger.warn(
          `Bulk cancel of order ${orderId} failed with ${code}${error instanceof Error ? ` (${error.name})` : ''}`,
        );
      }
    }

    result.remaining = await this.countOpenOrders(shopId);

    try {
      await this.auditService.record(this.prisma, {
        actorId: adminId,
        action: 'CANCEL_SHOP_OPEN_ORDERS',
        targetType: 'SHOP',
        targetId: shopId,
        reason: input.reason,
        meta: {
          phase: 'FINISHED',
          matched,
          cancelled: result.cancelled,
          failed: result.failed.length,
          needsManualRefund: result.needsManualRefund.length,
          refundsPending: result.refundsPending,
        },
        ...context,
      });
    } catch (error) {
      this.logger.error(
        `Could not write the closing audit row for the bulk cancel of shop ${shopId}${error instanceof Error ? `: ${error.name}` : ''}`,
      );
    }
    return result;
  }

  // 404 cho id sai dạng và id không có thật (cùng một kết quả, và id có NUL không thành 500); 409 SHOP_NOT_SUSPENDED khi shop
  // không ở trạng thái cho phép — việc hủy hàng loạt chỉ dành cho shop ĐANG bị khoá.
  private async assertShopSuspended(shopId: string): Promise<void> {
    if (!isUuid(shopId)) throw new NotFoundException('Shop not found');
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { status: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    if (shop.status !== 'SUSPENDED') {
      throw new AppException(
        409,
        'SHOP_NOT_SUSPENDED',
        'Open orders can only be cancelled in bulk while the shop is suspended',
      );
    }
  }

  private async isSuspended(shopId: string): Promise<boolean> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { status: true },
    });
    return shop?.status === 'SUSPENDED';
  }

  private countOpenOrders(shopId: string): Promise<number> {
    return this.prisma.order.count({
      where: { shopId, status: { in: OPEN_ORDER_STATUSES } },
    });
  }
}
