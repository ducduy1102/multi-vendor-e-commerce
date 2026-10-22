import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { frontendUrl } from '../../shared/mail/frontend-url';
import type { MailLocale } from '../../shared/mail/mail-locale';
import { MailService } from '../../shared/mail/mail.service';
import type {
  OrderCancelledBy,
  OrderEmailOrder,
  RefundRequestRejectedBy,
} from '../../shared/mail/templates/order-email.types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { readRefundEscalateDays, readRefundWindowDays } from './refund-config';

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
  // `locale` = ngôn ngữ email của buyer (Week9.md 1.12).
  user: { select: { email: true, name: true, locale: true } },
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
// đang giao, bị hủy, đã duyệt trả hàng. Mọi hàm `notify*`:
//  - gọi SAU KHI DB đã commit (không bao giờ nằm trong $transaction — gọi dịch vụ ngoài trong
//    transaction giữ khoá lâu và khiến mail lỗi làm rollback cả đơn);
//  - KHÔNG BAO GIỜ ném lỗi: DB đã xong việc của nó, mail lỗi (Resend down, sai key, hết quota, user
//    không có email...) chỉ được log — cùng pattern AuthService.sendVerificationEmailSafely
//    (rules/backend.md mục 4);
//  - tự đọc dữ liệu cần gửi (tên/email buyer, dòng hàng...) bằng 1 truy vấn nhỏ sau commit.
// Ngôn ngữ email = `User.locale` của buyer, đọc cùng truy vấn nhỏ đó (Week9.md 1.12); link trong email có
// prefix ngôn ngữ tương ứng (`frontendUrl`).
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
        locale: first.user.locale,
        buyerName: first.user.name,
        ordersUrl: this.ordersUrl(first.user.locale),
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
        locale: order.user.locale,
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(order.user.locale, orderId),
        order: this.toEmailOrder(order),
      });
    });
  }

  notifyShipped(orderId: string): Promise<void> {
    return this.safely('order-shipped', orderId, async () => {
      const [order] = await this.load({ id: orderId });
      if (!order) return;
      await this.mailService.sendOrderShipped(order.user.email, {
        locale: order.user.locale,
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(order.user.locale, orderId),
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
        locale: first.user.locale,
        buyerName: first.user.name,
        ordersUrl: this.ordersUrl(
          first.user.locale,
          orders.length === 1 ? first.id : undefined,
        ),
        orders: orders.map((o) => this.toEmailOrder(o)),
        cancelledBy,
        reason,
        refundAmount,
      });
    });
  }

  // Duyệt trả hàng/hoàn tiền SAU giao (COMPLETED → REFUNDED, Week9.md 1.3). `refundAmount` = số tiền của
  // khoản hoàn qua cổng (PaymentRefund); null = không có khoản hoàn qua cổng (đơn COD — shop hoàn tiền mặt
  // trực tiếp) ⇒ dùng tổng của đơn. Đơn đã trả online ⇒ "đang hoàn về phương thức thanh toán ban đầu".
  notifyRefunded(
    orderId: string,
    refundAmount: number | null = null,
  ): Promise<void> {
    return this.safely('order-refunded', orderId, async () => {
      const [order] = await this.load({ id: orderId });
      if (!order) return;
      const method = order.checkoutGroup.payments[0]?.method ?? null;
      await this.mailService.sendOrderRefunded(order.user.email, {
        locale: order.user.locale,
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(order.user.locale, orderId),
        order: this.toEmailOrder(order),
        refundAmount: refundAmount ?? order.totalAmount.toNumber(),
        refundTo: method === 'COD' ? 'SHOP_CASH' : 'ORIGINAL_PAYMENT',
      });
    });
  }

  // Đơn đã hoàn tất (SHIPPING → COMPLETED, Week10.md 7.5): người mua tự bấm "đã nhận hàng" hoặc hệ thống tự hoàn tất sau
  // `days` ngày không xác nhận. Nhắc cửa sổ trả hàng/hoàn tiền còn lại và, nếu còn sản phẩm chưa được đánh giá, mời đánh giá.
  notifyCompleted(
    orderId: string,
    how: { by: 'BUYER' } | { by: 'SYSTEM'; days: number },
  ): Promise<void> {
    return this.safely('order-completed', orderId, async () => {
      const [order] = await this.load({ id: orderId });
      if (!order) return;
      await this.mailService.sendOrderCompleted(order.user.email, {
        locale: order.user.locale,
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(order.user.locale, orderId),
        order: this.toEmailOrder(order),
        completedBy: how.by,
        autoCompleteDays: how.by === 'SYSTEM' ? how.days : 0,
        returnWindowDays: readRefundWindowDays(),
        invitesReview: await this.hasUnreviewedProduct(orderId),
      });
    });
  }

  // Yêu cầu hủy / trả hàng bị từ chối bởi shop hoặc Admin (Week10.md 7.5). `reason` do người quyết định nhập (có thể rỗng).
  // Shop từ chối ⇒ người mua còn khiếu nại được lên sàn nên email nêu số ngày; Admin từ chối ⇒ quyết định cuối.
  notifyRefundRequestRejected(
    refundRequestId: string,
    rejectedBy: RefundRequestRejectedBy,
    reason: string | null | undefined,
  ): Promise<void> {
    return this.safely('refund-request-rejected', refundRequestId, async () => {
      const request = await this.prisma.refundRequest.findUnique({
        where: { id: refundRequestId },
        select: { kind: true, order: { select: emailOrderSelect } },
      });
      if (!request) return;
      const { order } = request;
      await this.mailService.sendRefundRequestRejected(order.user.email, {
        locale: order.user.locale,
        buyerName: order.user.name,
        ordersUrl: this.ordersUrl(order.user.locale, order.id),
        order: this.toEmailOrder(order),
        kind: request.kind,
        rejectedBy,
        reason: reason?.trim() || null,
        escalateDays: rejectedBy === 'SELLER' ? readRefundEscalateDays() : null,
      });
    });
  }

  // Còn ít nhất một sản phẩm của đơn mà người mua chưa đánh giá? (Review nối với đơn qua orderId; OrderItem không có
  // productId nên nối qua variant → sản phẩm.) Module order đọc thẳng bảng reviews bằng PrismaService — chỉ ĐỌC.
  private async hasUnreviewedProduct(orderId: string): Promise<boolean> {
    const [items, reviews] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { orderId },
        select: { productVariant: { select: { productId: true } } },
      }),
      this.prisma.review.findMany({
        where: { orderId },
        select: { productId: true },
      }),
    ]);
    const reviewed = new Set(reviews.map((review) => review.productId));
    return items.some((item) => !reviewed.has(item.productVariant.productId));
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

  private ordersUrl(locale: MailLocale, orderId?: string): string {
    return frontendUrl(orderId ? `/orders/${orderId}` : '/orders', locale);
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
