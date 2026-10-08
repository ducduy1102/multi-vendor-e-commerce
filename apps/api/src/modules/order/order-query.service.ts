import { Injectable } from '@nestjs/common';
import {
  blocksSellerFulfilment,
  ORDER_LIST_PREVIEW_ITEMS,
  ORDER_STATUSES_VISIBLE_TO_SELLER,
  ORDER_TAB_STATUSES,
  type BuyerRefundRequest,
  type OrderDetail,
  type OrderHistoryEntry,
  type OrderListItem,
  type OrderListQuery,
  type OrderListResponse,
  type OrderRefundSummary,
  type SellerOrderDetail,
  type SellerOrderListItem,
  type SellerOrderListQuery,
  type SellerOrderListResponse,
} from '@ecommerce/types';
import type { OrderStatus, Prisma } from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import { readPaymentMaxHoldMinutes } from '../../shared/payment/payment-config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  canRetryOrderPayment,
  getBuyerOrderActions,
  getBuyerRefundRequestActions,
  getSellerOrderActions,
} from './order-actions';
import { readRefundEscalateDays, readRefundWindowDays } from './refund-config';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

// Số tiền VND luôn là chuỗi số nguyên đồng trong response (cùng quy ước CartView/CheckoutGroup).
const money = (value: Prisma.Decimal): string => String(value.toNumber());

const itemSelect = {
  productName: true,
  variantLabel: true,
  sku: true,
  imageUrl: true,
  quantity: true,
  priceAtPurchase: true,
} satisfies Prisma.OrderItemSelect;

// Thanh toán gắn theo NHÓM (1 Payment cho N đơn): mọi lần thử, mới nhất trước — đủ để lấy phương
// thức/trạng thái hiện tại và quyết định có "thanh toán lại" được không.
const paymentSelect = {
  method: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

// Chỉ dòng `→ COMPLETED` mới nhất — đủ tính cửa sổ trả hàng (Week9.md 1.3) cho cờ canRequestReturn ở danh
// sách mà không kéo cả timeline. Chi tiết ghi đè bằng đủ lịch sử (historyArgs), nên hàm
// latestCompletedAt phải lọc theo toStatus chứ không giả định mọi dòng đều là COMPLETED.
const completedAtArgs = {
  where: { toStatus: 'COMPLETED' },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { toStatus: true, createdAt: true },
} satisfies Prisma.Order$statusHistoryArgs;

// Yêu cầu hủy/trả hàng CHƯA RÚT của đơn, mới nhất trước (Week9.md 1.4). Mỗi đơn tối đa một yêu cầu mỗi loại
// nên tối đa 2 dòng: vừa đủ cho cờ canRequestCancel/canRequestReturn (qua `kind`) lẫn hiển thị yêu cầu mới
// nhất kèm dòng thời gian. KHÔNG select actorId của history — người mua không cần (và không nên) biết định
// danh seller/Admin đã quyết định.
const buyerRefundRequestArgs = {
  where: { status: { not: 'WITHDRAWN' } },
  orderBy: { createdAt: 'desc' },
  select: {
    id: true,
    kind: true,
    status: true,
    reasonCode: true,
    reasonNote: true,
    sellerRespondBy: true,
    statusChangedAt: true,
    createdAt: true,
    history: {
      select: {
        toStatus: true,
        actorType: true,
        note: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    },
  },
} satisfies Prisma.Order$refundRequestsArgs;

// Khoản hoàn tiền qua cổng của đơn (sổ cái PaymentRefund, orderId unique ⇒ tối đa một). Chỉ trạng thái +
// số tiền: lý do lỗi/mã cổng là thông tin nội bộ cho Admin.
const paymentRefundArgs = {
  select: { status: true, amount: true },
} satisfies Prisma.Order$paymentRefundArgs;

const listSelect = {
  id: true,
  checkoutGroupId: true,
  status: true,
  createdAt: true,
  totalAmount: true,
  shop: { select: { id: true, name: true, slug: true, logoUrl: true } },
  items: {
    select: itemSelect,
    orderBy: { id: 'asc' },
    take: ORDER_LIST_PREVIEW_ITEMS,
  },
  _count: { select: { items: true } },
  checkoutGroup: {
    select: {
      createdAt: true,
      payments: { select: paymentSelect, orderBy: { createdAt: 'desc' } },
    },
  },
  statusHistory: completedAtArgs,
  refundRequests: buyerRefundRequestArgs,
  paymentRefund: paymentRefundArgs,
} satisfies Prisma.OrderSelect;

// Lúc đơn COMPLETED gần nhất trong 1 danh sách dòng lịch sử (rỗng/không có ⇒ null).
function latestCompletedAt(
  history: readonly { toStatus: OrderStatus; createdAt: Date }[],
): Date | null {
  return history
    .filter((entry) => entry.toStatus === 'COMPLETED')
    .reduce<Date | null>(
      (latest, entry) =>
        latest === null || entry.createdAt > latest ? entry.createdAt : latest,
      null,
    );
}

// Timeline cũ → mới. KHÔNG select actorId — không bên nào (buyer/seller) cần định danh người thực hiện.
const historyArgs = {
  select: {
    fromStatus: true,
    toStatus: true,
    actorType: true,
    note: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'asc' },
} satisfies Prisma.Order$statusHistoryArgs;

const detailSelect = {
  ...listSelect,
  // Ghi đè bản xem nhanh: chi tiết trả đủ dòng hàng.
  items: { select: itemSelect, orderBy: { id: 'asc' } },
  recipientName: true,
  recipientPhone: true,
  shippingAddressLine: true,
  shippingWard: true,
  shippingProvince: true,
  discountAmount: true,
  shippingFee: true,
  carrier: true,
  trackingCode: true,
  buyerNote: true,
  statusHistory: historyArgs,
} satisfies Prisma.OrderSelect;

// Seller chỉ cần phương thức/trạng thái của lần thử thanh toán MỚI NHẤT (COD: thu tiền mặt khi giao;
// online: đã trả). Không đọc userId/email của buyer — chỉ snapshot người nhận trên đơn.
const sellerListSelect = {
  id: true,
  status: true,
  createdAt: true,
  totalAmount: true,
  recipientName: true,
  shippingProvince: true,
  // Lời nhắn của người mua gửi RIÊNG đơn này (mỗi đơn một lời nhắn, Week8.md 3B) — cả danh sách lẫn chi tiết.
  buyerNote: true,
  items: {
    select: itemSelect,
    orderBy: { id: 'asc' },
    take: ORDER_LIST_PREVIEW_ITEMS,
  },
  _count: { select: { items: true } },
  checkoutGroup: {
    select: {
      payments: {
        select: { method: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
  // Yêu cầu của người mua để tắt canPack/canShip khi đang có yêu cầu HỦY chờ xử lý (Week9.md 1.3) —
  // kind + status vừa đủ cho blocksSellerFulfilment; không đọc lý do/ghi chú của người mua ở danh sách.
  refundRequests: {
    where: { status: { not: 'WITHDRAWN' } },
    select: { kind: true, status: true },
  },
} satisfies Prisma.OrderSelect;

const sellerDetailSelect = {
  ...sellerListSelect,
  items: { select: itemSelect, orderBy: { id: 'asc' } },
  recipientPhone: true,
  shippingAddressLine: true,
  shippingWard: true,
  discountAmount: true,
  shippingFee: true,
  carrier: true,
  trackingCode: true,
  statusHistory: historyArgs,
} satisfies Prisma.OrderSelect;

type LoadedListOrder = Prisma.OrderGetPayload<{ select: typeof listSelect }>;
type LoadedDetailOrder = Prisma.OrderGetPayload<{
  select: typeof detailSelect;
}>;
type LoadedSellerListOrder = Prisma.OrderGetPayload<{
  select: typeof sellerListSelect;
}>;
type LoadedSellerDetailOrder = Prisma.OrderGetPayload<{
  select: typeof sellerDetailSelect;
}>;

const toHistoryEntry = (entry: {
  fromStatus: OrderHistoryEntry['fromStatus'];
  toStatus: OrderHistoryEntry['toStatus'];
  actorType: OrderHistoryEntry['actorType'];
  note: string | null;
  createdAt: Date;
}): OrderHistoryEntry => ({
  fromStatus: entry.fromStatus,
  toStatus: entry.toStatus,
  actorType: entry.actorType,
  note: entry.note,
  createdAt: entry.createdAt.toISOString(),
});

const toBuyerRefundRequest = (
  request: LoadedListOrder['refundRequests'][number],
  now: Date,
): BuyerRefundRequest => ({
  id: request.id,
  kind: request.kind,
  status: request.status,
  reasonCode: request.reasonCode,
  reasonNote: request.reasonNote,
  sellerRespondBy: request.sellerRespondBy.toISOString(),
  statusChangedAt: request.statusChangedAt.toISOString(),
  createdAt: request.createdAt.toISOString(),
  history: request.history.map((entry) => ({
    toStatus: entry.toStatus,
    actorType: entry.actorType,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
  })),
  ...getBuyerRefundRequestActions({
    kind: request.kind,
    status: request.status,
    statusChangedAt: request.statusChangedAt,
    now,
    escalateDays: readRefundEscalateDays(),
  }),
});

const toRefundSummary = (
  refund: LoadedListOrder['paymentRefund'],
): OrderRefundSummary | null =>
  refund ? { status: refund.status, amount: money(refund.amount) } : null;

// Phần ĐỌC của module order (buyer ở 2.4; seller thêm ở 2.5). Ghi/chuyển trạng thái nằm ở
// OrderStatusService + các service hành động.
@Injectable()
export class OrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // GET /orders — luôn lọc theo userId từ token (không tin client). `tab` là nhóm trạng thái.
  async listForBuyer(
    userId: string,
    query: OrderListQuery,
  ): Promise<OrderListResponse> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(query.tab
        ? { status: { in: [...ORDER_TAB_STATUSES[query.tab]] } }
        : {}),
    };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const now = new Date();
    return {
      items: orders.map((order) => this.toListItem(order, now)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // GET /orders/:id — đơn của người khác coi như không tồn tại (404, không 403) để không lộ id nào có
  // thật, cùng luật AddressService/getCheckoutGroup.
  async getForBuyer(userId: string, orderId: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: detailSelect,
    });
    if (!order) {
      throw new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    const subtotal = order.items.reduce(
      (sum, item) => sum + item.priceAtPurchase.toNumber() * item.quantity,
      0,
    );
    return {
      ...this.toListItem(order, new Date()),
      items: order.items.map((item) => this.toItem(item)),
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      shippingAddressLine: order.shippingAddressLine,
      shippingWard: order.shippingWard,
      shippingProvince: order.shippingProvince,
      subtotal: String(subtotal),
      discountAmount: money(order.discountAmount),
      shippingFee: money(order.shippingFee),
      carrier: order.carrier,
      trackingCode: order.trackingCode,
      buyerNote: order.buyerNote,
      // Không trả actorId — buyer không cần (và không nên) biết định danh seller/admin.
      history: order.statusHistory.map(toHistoryEntry),
    };
  }

  // GET /shops/:shopId/orders — shopId đã được ShopOwnerGuard xác nhận là của người gọi. Luôn lọc theo
  // ORDER_STATUSES_VISIBLE_TO_SELLER (đơn AWAITING_PAYMENT TUYỆT ĐỐI không lộ cho Seller, Week7.md
  // 1.13); `tab` chỉ THU HẸP trong tập đó, không bao giờ mở rộng.
  async listForSeller(
    shopId: string,
    query: SellerOrderListQuery,
  ): Promise<SellerOrderListResponse> {
    const where: Prisma.OrderWhereInput = {
      shopId,
      ...sellerVisibleOrderFilter(this.visibleStatuses(query.tab)),
    };

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: sellerListSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items: orders.map((order) => this.toSellerListItem(order)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // GET /shops/:shopId/orders/:orderId — đơn của shop khác, đơn AWAITING_PAYMENT và đơn không tồn tại
  // cùng trả 404 y hệt nhau (không lộ id nào có thật, không lộ đơn chưa thanh toán).
  async getForSeller(
    shopId: string,
    orderId: string,
  ): Promise<SellerOrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId,
        ...sellerVisibleOrderFilter(this.visibleStatuses()),
      },
      select: sellerDetailSelect,
    });
    if (!order) {
      throw new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    const subtotal = order.items.reduce(
      (sum, item) => sum + item.priceAtPurchase.toNumber() * item.quantity,
      0,
    );
    return {
      ...this.toSellerListItem(order),
      items: order.items.map((item) => this.toItem(item)),
      recipientPhone: order.recipientPhone,
      shippingAddressLine: order.shippingAddressLine,
      shippingWard: order.shippingWard,
      subtotal: String(subtotal),
      discountAmount: money(order.discountAmount),
      shippingFee: money(order.shippingFee),
      carrier: order.carrier,
      trackingCode: order.trackingCode,
      history: order.statusHistory.map(toHistoryEntry),
    };
  }

  // Tập trạng thái Seller được thấy, thu hẹp theo tab nếu có. Giao với
  // ORDER_STATUSES_VISIBLE_TO_SELLER dù kiểu của `tab` đã loại awaiting-payment (phòng thủ nhiều lớp).
  private visibleStatuses(tab?: SellerOrderListQuery['tab']) {
    const visible = [...ORDER_STATUSES_VISIBLE_TO_SELLER];
    if (!tab) return visible;
    return ORDER_TAB_STATUSES[tab].filter((status) => visible.includes(status));
  }

  private toSellerListItem(
    order: LoadedSellerListOrder | LoadedSellerDetailOrder,
  ): SellerOrderListItem {
    const latest = order.checkoutGroup.payments[0] ?? null;
    return {
      id: order.id,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      totalAmount: money(order.totalAmount),
      recipientName: order.recipientName,
      shippingProvince: order.shippingProvince,
      buyerNote: order.buyerNote,
      items: order.items
        .slice(0, ORDER_LIST_PREVIEW_ITEMS)
        .map((item) => this.toItem(item)),
      itemCount: order._count.items,
      paymentMethod: latest?.method ?? null,
      paymentStatus: latest?.status ?? null,
      ...getSellerOrderActions({
        status: order.status,
        paymentMethod: latest?.method ?? null,
        hasBlockingCancelRequest: order.refundRequests.some((request) =>
          blocksSellerFulfilment(request.kind, request.status),
        ),
      }),
    };
  }

  private toItem(
    item: LoadedListOrder['items'][number],
  ): OrderListItem['items'][number] {
    return {
      productName: item.productName,
      variantLabel: item.variantLabel,
      sku: item.sku,
      imageUrl: item.imageUrl,
      quantity: item.quantity,
      priceAtPurchase: money(item.priceAtPurchase),
    };
  }

  private toListItem(
    order: LoadedListOrder | LoadedDetailOrder,
    now: Date,
  ): OrderListItem {
    const { payments, createdAt: groupCreatedAt } = order.checkoutGroup;
    const latest = payments[0] ?? null;
    const actions = getBuyerOrderActions({
      status: order.status,
      paymentMethod: latest?.method ?? null,
      canRetryPayment: canRetryOrderPayment({
        orderStatus: order.status,
        payments,
        groupCreatedAt,
        now,
        maxHoldMinutes: readPaymentMaxHoldMinutes(),
      }),
      completedAt: latestCompletedAt(order.statusHistory),
      now,
      refundWindowDays: readRefundWindowDays(),
      existingRequestKinds: order.refundRequests.map((request) => request.kind),
    });

    return {
      id: order.id,
      checkoutGroupId: order.checkoutGroupId,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      totalAmount: money(order.totalAmount),
      shop: order.shop,
      items: order.items
        .slice(0, ORDER_LIST_PREVIEW_ITEMS)
        .map((item) => this.toItem(item)),
      itemCount: order._count.items,
      paymentMethod: latest?.method ?? null,
      paymentStatus: latest?.status ?? null,
      ...actions,
      // Yêu cầu MỚI NHẤT (mảng đã sắp mới nhất trước); null = người mua chưa gửi hoặc đã rút hết.
      refundRequest: order.refundRequests[0]
        ? toBuyerRefundRequest(order.refundRequests[0], now)
        : null,
      refund: toRefundSummary(order.paymentRefund),
    };
  }
}
