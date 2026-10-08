import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MailService } from '../../shared/mail/mail.service';
import type {
  OrderCancelledBy,
  OrderEmailOrder,
} from '../../shared/mail/templates/order-email.types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { getFrontendUrl } from '../../shared/utils/frontend-url';

const emailOrderSelect = {
  id: true,
  totalAmount: true,
  discountAmount: true,
  shippingFee: true,
  recipientName: true,
  recipientPhone: true,
  shippingAddressLine: true,
  shippingWard: true,
  shippingProvince: true,
  carrier: true,
  trackingCode: true,
  user: { select: { email: true, name: true } },
  shop: { select: { name: true } },
  items: {
    select: {
      productName: true,
      variantLabel: true,
      quantity: true,
      priceAtPurchase: true,
    },
    orderBy: { id: 'asc' },
  },
  checkoutGroup: {
    select: {
      payments: {
        select: { method: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.OrderSelect;

type LoadedEmailOrder = Prisma.OrderGetPayload<{
  select: typeof emailOrderSelect;
}>;

export type CancelledTarget =
  { orderIds: string[] } | { checkoutGroupId: string };

// Email giao dịch cho buyer khi đơn đổi trạng thái (Week8.md 1.12/2.8): đặt thành công, shop xác nhận,
// đang giao, bị hủy. Mọi hàm `notify*`:
//  - gọi SAU KHI DB đã commit (không bao giờ nằm trong $transaction — gọi dịch vụ ngoài trong
//    transaction giữ khoá lâu và khiến mail lỗi làm rollback cả đơn);
//  - KHÔNG BAO GIỜ ném lỗi: DB đã xong việc của nó, mail lỗi (Resend down, sai key, hết quota, user
//    không có email...) chỉ được log — cùng pattern AuthService.sendVerificationEmailSafely
//    (rules/backend.md mục 4);
//  - tự đọc dữ liệu cần gửi (tên/email buyer, dòng hàng...) bằng 1 truy vấn nhỏ sau commit.
// Email tiếng Việt cố định: `User` chưa có field locale (Week8.md 1.12).
@Injectable()
export class OrderEmailService {
  private readonly logger = new Logger(OrderEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // Đặt hàng thành công: COD ngay lúc đặt, đơn online khi thanh toán được xác nhận. 1 email gộp mọi đơn
  // (mọi shop) của nhóm thanh toán.
  notifyPlaced(checkoutGroupId: string): Promise<void> {
    return this.safely('order-placed', checkoutGroupId, async () => {
      const orders = await this.load({ checkoutGroupId });
      if (orders.length === 0) return;
      const first = orders[0];
      await this.mailService.sendOrderPlaced(first.user.email, {
        buyerName: first.user.name,
        ordersUrl: this.ordersUrl(),
        orders: orders.map((o) => this.toEmailOrder(o)),
        paymentMethod: first.checkoutGroup.payments[0]?.method ?? null,
        recipient: {
          name: first.recipientName,
          phone: first.recipientPhone,
          address: this.addressOf(first),
        },
      });
    });
  }

  notifyConfirmed(orderId: string): Promise<void> {
    return this.safely('order-confirmed', orderId, async () => {
      const [order] = await this.load({ id: orderId });
      if (!order) return;
      await this.mailService.sendOrderConfirmed(order.user.email, {
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(orderId),
        order: this.toEmailOrder(order),
      });
    });
  }

  notifyShipped(orderId: string): Promise<void> {
    return this.safely('order-shipped', orderId, async () => {
      const [order] = await this.load({ id: orderId });
      if (!order) return;
      await this.mailService.sendOrderShipped(order.user.email, {
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(orderId),
        order: this.toEmailOrder(order),
        carrier: order.carrier,
        trackingCode: order.trackingCode,
      });
    });
  }

  // Hủy theo từng đơn (seller từ chối/hủy, buyer hủy, duyệt yêu cầu hủy) hoặc theo nhóm (buyer hủy nhóm
  // chưa thanh toán, hết hạn thanh toán — chỉ lấy các đơn ĐÃ CANCELLED của nhóm). 1 email gộp.
  // `refundAmount` = số tiền đang hoàn về phương thức thanh toán ban đầu (đơn đã trả online, Week9.md 1.5);
  // null = không có khoản hoàn (COD, nhóm chưa thanh toán).
  notifyCancelled(
    target: CancelledTarget,
    cancelledBy: OrderCancelledBy,
    reason: string | null = null,
    refundAmount: number | null = null,
  ): Promise<void> {
    const key =
      'orderIds' in target ? target.orderIds.join(',') : target.checkoutGroupId;
    return this.safely('order-cancelled', key, async () => {
      const orders = await this.load(
        'orderIds' in target
          ? { id: { in: target.orderIds }, status: 'CANCELLED' }
          : { checkoutGroupId: target.checkoutGroupId, status: 'CANCELLED' },
      );
      if (orders.length === 0) return;
      const first = orders[0];
      await this.mailService.sendOrderCancelled(first.user.email, {
        buyerName: first.user.name,
        ordersUrl: this.ordersUrl(orders.length === 1 ? first.id : undefined),
        orders: orders.map((o) => this.toEmailOrder(o)),
        cancelledBy,
        reason,
        refundAmount,
      });
    });
  }

  private async safely(
    kind: string,
    key: string,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(
        `Gửi email ${kind} thất bại (${key}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private load(where: Prisma.OrderWhereInput): Promise<LoadedEmailOrder[]> {
    return this.prisma.order.findMany({
      where,
      select: emailOrderSelect,
      orderBy: { id: 'asc' },
    });
  }

  private ordersUrl(orderId?: string): string {
    const base = getFrontendUrl().replace(/\/+$/, '');
    return orderId ? `${base}/orders/${orderId}` : `${base}/orders`;
  }

  private addressOf(order: LoadedEmailOrder): string {
    return [
      order.shippingAddressLine,
      order.shippingWard,
      order.shippingProvince,
    ].join(', ');
  }

  private toEmailOrder(order: LoadedEmailOrder): OrderEmailOrder {
    return {
      orderCode: order.id.slice(0, 8).toUpperCase(),
      shopName: order.shop.name,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        unitPrice: item.priceAtPurchase.toNumber(),
      })),
      shippingFee: order.shippingFee.toNumber(),
      discountAmount: order.discountAmount.toNumber(),
      totalAmount: order.totalAmount.toNumber(),
    };
  }
}
