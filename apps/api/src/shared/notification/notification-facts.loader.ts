import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  NotificationEvent,
  NotificationFacts,
  OrderFacts,
} from './notification-events';

// Chỉ những cột cần để quyết định người nhận và dựng nhãn (rules/backend.md mục 4: query chỉ select field cần dùng).
// Người mua = order.userId, chủ shop = shop.ownerId: MỌI người nhận đều suy ra từ đây, không từ dữ liệu client.
const orderFactsSelect = {
  id: true,
  userId: true,
  shop: { select: { ownerId: true, name: true } },
  // Có dòng lịch sử toStatus = PENDING ⇒ shop đã từng thấy đơn. Cùng điều kiện với `sellerVisibleOrderFilter`
  // (modules/order) — shared/ không import được modules/, nên lặp lại một dòng ở đây; int-spec của loader chứa ca
  // đơn chưa từng PENDING để lệch luật là test đỏ.
  statusHistory: {
    where: { toStatus: 'PENDING' },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.OrderSelect;

type OrderFactsRow = Prisma.OrderGetPayload<{
  select: typeof orderFactsSelect;
}>;

function toOrderFacts(row: OrderFactsRow): OrderFacts {
  return {
    orderId: row.id,
    buyerId: row.userId,
    shopOwnerId: row.shop.ownerId,
    shopName: row.shop.name,
    visibleToSeller: row.statusHistory.length > 0,
  };
}

// Tải dữ kiện của một sự kiện từ DB (Week10.md 7.3). Trả null khi bản ghi nguồn không còn (đã bị xoá giữa lúc commit
// và lúc đọc — hiếm); service coi đó là "không có gì để báo" thay vì lỗi. Chỉ ĐỌC, không ghi gì.
@Injectable()
export class NotificationFactsLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(event: NotificationEvent): Promise<NotificationFacts | null> {
    switch (event.kind) {
      case 'ORDERS_PLACED':
        // Chỉ đơn đã vào PENDING: đơn online chưa thanh toán (AWAITING_PAYMENT) không được lộ cho shop.
        return this.orders({
          checkoutGroupId: event.checkoutGroupId,
          statusHistory: { some: { toStatus: 'PENDING' } },
        });

      case 'ORDER_CONFIRMED':
      case 'ORDER_SHIPPED':
      case 'ORDER_AUTO_COMPLETED':
      case 'REFUND_COMPLETED':
        return this.orderById(event.orderId);

      case 'ORDERS_CANCELLED':
        // Chỉ lấy các đơn ĐÃ CANCELLED (cùng quy ước với OrderEmailService.notifyCancelled): một nhóm có thể còn đơn
        // chưa hủy, và danh sách `orderIds` do nơi gọi truyền không được tin là đã đúng trạng thái.
        return this.orders(
          'orderIds' in event.target
            ? { id: { in: event.target.orderIds }, status: 'CANCELLED' }
            : {
                checkoutGroupId: event.target.checkoutGroupId,
                status: 'CANCELLED',
              },
        );

      case 'REFUND_REQUEST_CREATED':
      case 'REFUND_REQUEST_APPROVED':
      case 'REFUND_REQUEST_REJECTED':
      case 'REFUND_REQUEST_DECIDED_BY_ADMIN':
        return this.refundRequest(event.refundRequestId, false);

      case 'REFUND_REQUEST_ESCALATED':
        return this.refundRequest(event.refundRequestId, true);

      case 'REVIEW_CREATED':
      case 'REVIEW_REPLIED':
        return this.review(event.reviewId);

      case 'SHOP_STATUS_CHANGED':
        return this.shop(event.shopId, false);

      case 'SHOP_SUBMITTED':
      case 'APPEAL_SUBMITTED':
        return this.shop(event.shopId, true);

      case 'APPEAL_DECIDED':
        return this.shop(event.shopId, false);

      case 'REPORTS_RESOLVED':
        return this.reports(event.reportIds);

      case 'REPORT_SUBMITTED':
        // Người nhận là mọi Admin ACTIVE; báo cáo vừa được tạo nên không cần tải lại hàng nào (và không đọc nội dung báo cáo).
        return { kind: 'ADMINS', adminIds: await this.activeAdminIds() };

      default: {
        const unhandled: never = event;
        throw new Error(
          `Unhandled notification event ${JSON.stringify(unhandled)}`,
        );
      }
    }
  }

  private async orders(
    where: Prisma.OrderWhereInput,
  ): Promise<NotificationFacts> {
    const rows = await this.prisma.order.findMany({
      where,
      select: orderFactsSelect,
      orderBy: { id: 'asc' },
    });
    return { kind: 'ORDERS', orders: rows.map(toOrderFacts) };
  }

  private async orderById(orderId: string): Promise<NotificationFacts | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: orderFactsSelect,
    });
    return row ? { kind: 'ORDERS', orders: [toOrderFacts(row)] } : null;
  }

  private async refundRequest(
    refundRequestId: string,
    withAdmins: boolean,
  ): Promise<NotificationFacts | null> {
    const row = await this.prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      select: {
        orderId: true,
        kind: true,
        userId: true,
        shop: { select: { ownerId: true } },
      },
    });
    if (!row) return null;
    return {
      kind: 'REFUND_REQUEST',
      request: {
        orderId: row.orderId,
        kind: row.kind,
        buyerId: row.userId,
        shopOwnerId: row.shop.ownerId,
      },
      adminIds: withAdmins ? await this.activeAdminIds() : [],
    };
  }

  private async review(reviewId: string): Promise<NotificationFacts | null> {
    const row = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        userId: true,
        rating: true,
        product: {
          select: {
            id: true,
            name: true,
            shop: { select: { ownerId: true, name: true } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      kind: 'REVIEW',
      review: {
        productId: row.product.id,
        productName: row.product.name,
        rating: row.rating,
        reviewerId: row.userId,
        shopOwnerId: row.product.shop.ownerId,
        shopName: row.product.shop.name,
      },
    };
  }

  private async shop(
    shopId: string,
    withAdmins: boolean,
  ): Promise<NotificationFacts | null> {
    const row = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!row) return null;
    return {
      kind: 'SHOP',
      shop: { shopId: row.id, shopName: row.name, ownerId: row.ownerId },
      adminIds: withAdmins ? await this.activeAdminIds() : [],
    };
  }

  // Báo cáo ĐÃ ĐÓNG của danh sách id: người nhận là người báo (cột của chính báo cáo), kết quả là trạng thái đã ghi. Báo cáo còn OPEN
  // (nơi gọi truyền nhầm) hoặc không tồn tại bị bỏ qua — không bao giờ báo "đã xử lý" cho việc chưa xử lý.
  private async reports(reportIds: string[]): Promise<NotificationFacts> {
    if (reportIds.length === 0) return { kind: 'REPORTS', reports: [] };
    const rows = await this.prisma.report.findMany({
      where: {
        id: { in: reportIds },
        status: { in: ['RESOLVED', 'DISMISSED'] },
      },
      select: { id: true, reporterId: true, targetType: true, status: true },
      orderBy: { id: 'asc' },
    });
    return {
      kind: 'REPORTS',
      reports: rows.flatMap((row) =>
        row.status === 'OPEN'
          ? []
          : [
              {
                reportId: row.id,
                reporterId: row.reporterId,
                targetType: row.targetType,
                outcome: row.status,
              },
            ],
      ),
    };
  }

  // "Tất cả ADMIN" = người dùng role ADMIN còn hoạt động. Một truy vấn, select hẹp.
  private async activeAdminIds(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', accountStatus: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return admins.map((admin) => admin.id);
  }
}
