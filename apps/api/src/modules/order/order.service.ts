import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@ecommerce/types';
import type { OrderStatus } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import { OrderStatusService } from './order-status.service';

// Sở hữu Order, OrderItem, Payment (Week7.md 1.14). `order` KHÔNG được import `checkout` — các kiểu
// dưới đây khai LẶP LẠI (không import) hình dạng dữ liệu mà CheckoutService truyền vào; TypeScript
// so khớp theo cấu trúc (structural typing) nên checkout truyền được CheckoutPlanOrder của nó vào
// đây mà không cần 2 phía cùng import 1 type dùng chung.

export interface CreateOrdersItemInput {
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  // Giá đã khoá lúc giữ chỗ, số nguyên VND (Order.priceAtPurchase).
  priceAtPurchase: number;
}

export interface CreateOrdersOrderInput {
  shopId: string;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  items: CreateOrdersItemInput[];
}

export interface CreateOrdersShippingSnapshot {
  recipientName: string;
  recipientPhone: string;
  shippingAddressLine: string;
  shippingWard: string;
  shippingProvince: string;
}

export interface CreateOrdersPaymentInput {
  method: PaymentMethod;
  // = Σ Order.totalAmount, số nguyên VND.
  amount: number;
  txnRef: string;
  // null = không hết hạn (COD, Week8.md 1.6).
  expiresAt: Date | null;
}

export interface CreateOrdersInput {
  checkoutGroupId: string;
  userId: string;
  // Giữ để truy vết/hiển thị (1.5) — voucher toàn sàn gắn cùng voucherId vào cả N Order, KHÔNG dùng
  // field này để đếm lượt dùng (đếm qua VoucherUsage, xem voucher-usage.service.ts).
  voucherId: string | null;
  shipping: CreateOrdersShippingSnapshot;
  orders: CreateOrdersOrderInput[];
  payment: CreateOrdersPaymentInput;
  // Trạng thái đầu của đơn: mặc định AWAITING_PAYMENT (chờ cổng thanh toán); COD vào thẳng PENDING
  // (chưa thu tiền, chờ shop xác nhận) — Week8.md 1.6.
  initialStatus?: Extract<OrderStatus, 'AWAITING_PAYMENT' | 'PENDING'>;
}

export interface CreatedOrderSummary {
  id: string;
  shopId: string;
  status: string;
  totalAmount: string;
}

export interface CreateOrdersResult {
  orders: CreatedOrderSummary[];
  paymentId: string;
}

@Injectable()
export class OrderService {
  constructor(private readonly orderStatusService: OrderStatusService) {}

  // Được CheckoutService.placeOrder gọi TRONG transaction đặt hàng (2.7) — nhận `tx` làm tham số
  // đầu tiên, không tự mở $transaction lồng, cùng quy ước với InventoryService/VoucherUsageService
  // (Week7.md 1.14). Tạo đủ N Order (kèm snapshot địa chỉ + OrderItem) và ĐÚNG 1 Payment cho cả nhóm.
  async createOrders(
    tx: TxClient,
    input: CreateOrdersInput,
  ): Promise<CreateOrdersResult> {
    const orders: CreatedOrderSummary[] = [];
    for (const orderInput of input.orders) {
      const order = await tx.order.create({
        data: {
          userId: input.userId,
          shopId: orderInput.shopId,
          checkoutGroupId: input.checkoutGroupId,
          status: input.initialStatus ?? 'AWAITING_PAYMENT',
          voucherId: input.voucherId,
          totalAmount: orderInput.totalAmount,
          discountAmount: orderInput.discountAmount,
          shippingFee: orderInput.shippingFee,
          recipientName: input.shipping.recipientName,
          recipientPhone: input.shipping.recipientPhone,
          shippingAddressLine: input.shipping.shippingAddressLine,
          shippingWard: input.shipping.shippingWard,
          shippingProvince: input.shipping.shippingProvince,
          items: {
            create: orderInput.items.map((item) => ({
              productVariantId: item.productVariantId,
              productName: item.productName,
              variantLabel: item.variantLabel,
              sku: item.sku,
              imageUrl: item.imageUrl,
              quantity: item.quantity,
              priceAtPurchase: item.priceAtPurchase,
            })),
          },
        },
        select: { id: true, shopId: true, status: true, totalAmount: true },
      });
      orders.push({
        id: order.id,
        shopId: order.shopId,
        status: order.status,
        totalAmount: order.totalAmount.toString(),
      });
    }

    // Mốc đầu của timeline (fromStatus = null) — người đặt đơn là buyer.
    await this.orderStatusService.recordCreated(
      tx,
      orders.map((o) => ({ id: o.id, status: o.status as OrderStatus })),
      { type: 'BUYER', id: input.userId },
    );

    const payment = await tx.payment.create({
      data: {
        checkoutGroupId: input.checkoutGroupId,
        method: input.payment.method,
        amount: input.payment.amount,
        txnRef: input.payment.txnRef,
        expiresAt: input.payment.expiresAt,
      },
      select: { id: true },
    });

    return { orders, paymentId: payment.id };
  }
}
