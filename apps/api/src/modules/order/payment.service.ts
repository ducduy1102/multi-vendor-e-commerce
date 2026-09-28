import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { PaymentMethod } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  readPaymentMaxHoldMinutes,
  readPaymentReclaimGraceMinutes,
  readPaymentTtlMinutes,
} from '../../shared/payment/payment-config';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import type { VerifiedCallback } from '../../shared/payment/payment-gateway.interface';
import { generateTxnRef } from '../../shared/payment/txn-ref';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import {
  canRetryFromStatus,
  deriveCheckoutGroupStatus,
} from './checkout-group-status';

// Kết quả nội bộ của confirmPayment — controller của từng cổng (2.9) tự ánh xạ sang mã phản hồi
// riêng (VNPay RspCode, Momo 204...), PaymentService không biết gì về hình dạng phản hồi của cổng.
export type ConfirmPaymentOutcome =
  | 'CONFIRMED'
  | 'ALREADY_CONFIRMED'
  | 'FAILED_RECORDED'
  | 'LATE_SUCCESS_RECORDED'
  | 'DUPLICATE_SUCCESS_RECORDED'
  | 'NOT_FOUND'
  | 'AMOUNT_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'UNRECOGNIZED';

export interface ConfirmPaymentResult {
  outcome: ConfirmPaymentOutcome;
  checkoutGroupId: string | null;
}

export interface RetryPaymentResult {
  paymentUrl: string;
  expiresAt: string;
  // true = vừa tạo lần thử mới (txnRef mới); false = trả lại payUrl đã lưu của lần thử còn hiệu
  // lực. Controller dùng để chọn 201/200 (route chốt ở Week7.md 1.14) — KHÔNG đưa vào response body
  // (payAttemptResultSchema chỉ có paymentUrl/expiresAt).
  created: boolean;
}

export interface CheckoutGroupOrderItemView {
  productName: string;
  variantLabel: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  priceAtPurchase: string;
}

export interface CheckoutGroupOrderView {
  id: string;
  shopId: string;
  shopName: string;
  status: OrderStatus;
  subtotal: string;
  discountAmount: string;
  shippingFee: string;
  totalAmount: string;
  items: CheckoutGroupOrderItemView[];
}

export interface CheckoutGroupView {
  id: string;
  status: ReturnType<typeof deriveCheckoutGroupStatus>;
  canRetry: boolean;
  expiresAt: string | null;
  createdAt: string;
  totalAmount: string;
  paymentMethod: PaymentMethod | null;
  latestPaymentStatus: PaymentStatus | null;
  orders: CheckoutGroupOrderView[];
}

const groupSelect = {
  id: true,
  userId: true,
  createdAt: true,
  orders: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      shopId: true,
      status: true,
      totalAmount: true,
      discountAmount: true,
      shippingFee: true,
      shop: { select: { name: true } },
      items: {
        select: {
          productVariantId: true,
          productName: true,
          variantLabel: true,
          sku: true,
          imageUrl: true,
          quantity: true,
          priceAtPurchase: true,
        },
      },
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      status: true,
      method: true,
      amount: true,
      txnRef: true,
      payUrl: true,
      expiresAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CheckoutGroupSelect;

type LoadedGroup = Prisma.CheckoutGroupGetPayload<{
  select: typeof groupSelect;
}>;

// Sở hữu xác nhận thanh toán, thu hồi giữ chỗ quá hạn, và đọc nhóm thanh toán (Week7.md 1.14, 2.9).
// Là NGƯỜI ĐIỀU PHỐI: mở transaction rồi gọi InventoryService/VoucherUsageService với `tx`, không tự
// viết SQL kho/voucher (đúng quy ước của CheckoutService.placeOrder).
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly voucherUsageService: VoucherUsageService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  // Được gọi bởi cả IPN lẫn return (2 nguồn, cùng 1 hàm, idempotent — Week7.md 1.10). Thứ tự bắt
  // buộc: (1) chữ ký [đã kiểm ở provider.verifyCallback TRƯỚC khi gọi hàm này] (2) tìm Payment theo
  // txnRef (3) so số tiền (4) rẽ nhánh bằng cập nhật có điều kiện trong 1 transaction ngắn.
  async confirmPayment(
    callback: VerifiedCallback,
    source: 'IPN' | 'RETURN',
  ): Promise<ConfirmPaymentResult> {
    if (!callback.isSignatureValid || !callback.txnRef) {
      this.logger.warn(`[${source}] invalid signature or missing txnRef`);
      return { outcome: 'INVALID_SIGNATURE', checkoutGroupId: null };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { txnRef: callback.txnRef },
      select: { id: true, status: true, amount: true, checkoutGroupId: true },
    });
    if (!payment) {
      this.logger.warn(`[${source}] txnRef not found: ${callback.txnRef}`);
      return { outcome: 'NOT_FOUND', checkoutGroupId: null };
    }

    if (
      callback.amountVnd === null ||
      callback.amountVnd !== payment.amount.toNumber()
    ) {
      this.logger.warn(
        `[${source}] amount mismatch txnRef=${callback.txnRef} expected=${payment.amount.toString()} got=${callback.amountVnd}`,
      );
      return {
        outcome: 'AMOUNT_MISMATCH',
        checkoutGroupId: payment.checkoutGroupId,
      };
    }

    if (callback.outcome === 'SUCCESS') {
      return this.confirmSuccess(payment, callback, source);
    }
    if (callback.outcome === 'FAILED') {
      return this.confirmFailure(payment, source);
    }
    // Trạng thái không xác định — "thà chờ hơn là kết luận sai" (1.10): không đổi gì, chỉ ghi nhận.
    this.logger.warn(
      `[${source}] unrecognized gateway outcome for txnRef=${callback.txnRef}`,
    );
    return {
      outcome: 'UNRECOGNIZED',
      checkoutGroupId: payment.checkoutGroupId,
    };
  }

  private async confirmSuccess(
    payment: { id: string; status: PaymentStatus; checkoutGroupId: string },
    callback: VerifiedCallback,
    source: 'IPN' | 'RETURN',
  ): Promise<ConfirmPaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      // Khoá đúng dòng Payment này — 2 lệnh xác nhận đồng thời (IPN + return, hoặc gọi lặp) cho
      // CÙNG txnRef sẽ xếp hàng ở đây; bên thua thấy status đã là SUCCESS sau khi được mở khoá.
      const lockedPayment = await tx.$queryRaw<{ status: PaymentStatus }[]>`
        SELECT status FROM payments WHERE id = ${payment.id} FOR UPDATE`;
      const currentStatus = lockedPayment[0].status;
      if (currentStatus === 'SUCCESS') {
        return {
          outcome: 'ALREADY_CONFIRMED' as const,
          checkoutGroupId: payment.checkoutGroupId,
        };
      }

      // Khoá TOÀN BỘ đơn của nhóm theo id tăng dần TRƯỚC (1.13 — cùng thứ tự với reclaimCheckoutGroup
      // để không deadlock giữa 2 đường xác nhận/thu hồi).
      const orders = await tx.$queryRaw<{ id: string; status: OrderStatus }[]>`
        SELECT id, status FROM orders WHERE checkout_group_id = ${payment.checkoutGroupId} ORDER BY id FOR UPDATE`;
      const orderIds = orders.map((o) => o.id);

      const { count: flippedCount } = await tx.order.updateMany({
        where: { id: { in: orderIds }, status: 'AWAITING_PAYMENT' },
        data: { status: 'PENDING' },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          transactionId: callback.gatewayTransactionId,
          paidAt: new Date(),
        },
      });

      if (flippedCount > 0) {
        if (currentStatus === 'FAILED') {
          this.logger.warn(
            `[${source}] payment ${payment.id} was FAILED but orders were still AWAITING_PAYMENT — flipped to SUCCESS anyway (gateway is the source of truth for money)`,
          );
        }
        const items = await tx.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { productVariantId: true, quantity: true },
        });
        await this.inventoryService.commit(
          tx,
          items.map((i) => ({
            productVariantId: i.productVariantId,
            quantity: i.quantity,
          })),
        );
        return {
          outcome: 'CONFIRMED' as const,
          checkoutGroupId: payment.checkoutGroupId,
        };
      }

      // 0 đơn lật được — số đơn lật là căn cứ phân biệt (1.13): đơn đang PENDING (đã có lần thử khác
      // thành công trước) ⇒ trùng; đơn đã CANCELLED (nhóm đã bị thu hồi) ⇒ thành công đến muộn.
      const anyPending = orders.some((o) => o.status === 'PENDING');
      if (anyPending) {
        this.logger.warn(
          `[${source}] duplicate SUCCESS for checkoutGroup=${payment.checkoutGroupId} — recorded, not committing inventory again; flag for refund review`,
        );
        return {
          outcome: 'DUPLICATE_SUCCESS_RECORDED' as const,
          checkoutGroupId: payment.checkoutGroupId,
        };
      }
      this.logger.warn(
        `[${source}] late SUCCESS for checkoutGroup=${payment.checkoutGroupId} after reclaim — recorded only, no inventory/order change; needs refund (Week 9)`,
      );
      return {
        outcome: 'LATE_SUCCESS_RECORDED' as const,
        checkoutGroupId: payment.checkoutGroupId,
      };
    });
  }

  private async confirmFailure(
    payment: { id: string; status: PaymentStatus; checkoutGroupId: string },
    source: 'IPN' | 'RETURN',
  ): Promise<ConfirmPaymentResult> {
    if (payment.status === 'SUCCESS') {
      this.logger.warn(
        `[${source}] ignoring FAILED callback for already-SUCCESS payment ${payment.id} — never downgrading`,
      );
      return {
        outcome: 'ALREADY_CONFIRMED',
        checkoutGroupId: payment.checkoutGroupId,
      };
    }
    // Chỉ lật ĐÚNG lần thử này — KHÔNG thu hồi nhóm (1.4): người dùng huỷ/thẻ bị từ chối phải thử
    // lại được, giữ chỗ tồn kho/voucher nguyên vẹn cho tới khi hết hạn thật.
    const { count } = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    return {
      outcome: count === 1 ? 'FAILED_RECORDED' : 'ALREADY_CONFIRMED',
      checkoutGroupId: payment.checkoutGroupId,
    };
  }

  // Thu hồi giữ chỗ của 1 nhóm quá hạn (Week7.md 1.4) — gọi từ job định kỳ (2.10) VÀ "hết hạn lười"
  // (dưới đây). An toàn gọi lặp/song song: mọi bước là cập nhật có điều kiện, lần lật 0 dòng thì
  // không nhả/chốt gì thêm. KHÔNG bao giờ đụng tới nhóm đã có Payment SUCCESS.
  async reclaimCheckoutGroup(
    checkoutGroupId: string,
  ): Promise<{ reclaimed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const hasSuccess = await tx.payment.count({
        where: { checkoutGroupId, status: 'SUCCESS' },
      });
      if (hasSuccess > 0) return { reclaimed: false };

      // (1) Mọi lần thử PENDING của nhóm → FAILED. 1 câu UPDATE duy nhất (không khoá từng dòng riêng
      // theo thứ tự tuỳ ý) để không deadlock với confirmPayment đang khoá đúng 1 dòng Payment khác.
      await tx.payment.updateMany({
        where: { checkoutGroupId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });

      // (2) Khoá TOÀN BỘ đơn của nhóm theo id tăng dần — CÙNG thứ tự với confirmSuccess.
      const orders = await tx.$queryRaw<{ id: string; status: OrderStatus }[]>`
        SELECT id, status FROM orders WHERE checkout_group_id = ${checkoutGroupId} ORDER BY id FOR UPDATE`;
      const awaitingIds = orders
        .filter((o) => o.status === 'AWAITING_PAYMENT')
        .map((o) => o.id);
      if (awaitingIds.length === 0) return { reclaimed: false };

      const { count } = await tx.order.updateMany({
        where: { id: { in: awaitingIds }, status: 'AWAITING_PAYMENT' },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) return { reclaimed: false };

      // (3) Nhả giữ chỗ tồn kho của ĐÚNG các đơn vừa lật (theo id variant tăng dần — InventoryService
      // tự sắp trong normalizeLines).
      const items = await tx.orderItem.findMany({
        where: { orderId: { in: awaitingIds } },
        select: { productVariantId: true, quantity: true },
      });
      await this.inventoryService.release(
        tx,
        items.map((i) => ({
          productVariantId: i.productVariantId,
          quantity: i.quantity,
        })),
      );

      // (4) Hoàn lượt voucher của nhóm (idempotent — chỉ nhả lượt CHƯA nhả).
      await this.voucherUsageService.release(tx, checkoutGroupId);

      this.logger.log(
        `Reclaimed checkoutGroup=${checkoutGroupId}: cancelled ${count} order(s)`,
      );
      return { reclaimed: true };
    });
  }

  // Chỉ chủ nhóm xem được — người khác coi như không tồn tại (404, cùng luật AddressService).
  // "Hết hạn lười" (1.4): nếu lần thử mới nhất đã quá expiresAt + ân hạn mà job (2.10) chưa kịp
  // chạy, tự thu hồi trước khi trả lời để người dùng không bao giờ thấy PENDING treo vô hạn.
  async getCheckoutGroup(
    userId: string,
    groupId: string,
  ): Promise<CheckoutGroupView> {
    const group = await this.loadGroupForOwner(userId, groupId);
    const fresh = await this.reclaimIfLapsedThenReload(group);
    return this.toView(fresh);
  }

  // "Tiếp tục thanh toán" / thanh toán lại (1.11 (4b), 1.4). Còn lần thử PENDING chưa hết hạn CÓ
  // payUrl ⇒ trả lại URL đã lưu; PENDING chưa hết hạn KHÔNG có payUrl (cổng lỗi sau commit) ⇒ đánh
  // dấu FAILED rồi tạo lần thử mới; FAILED còn trong hạn giữ ⇒ tạo lần thử mới. Từ chối khi đã trả
  // tiền, đã hết hạn giữ, hoặc chạm MAX_HOLD.
  async retryPayment(
    userId: string,
    groupId: string,
  ): Promise<RetryPaymentResult> {
    const group = await this.loadGroupForOwner(userId, groupId);
    const fresh = await this.reclaimIfLapsedThenReload(group);
    const now = new Date();
    const status = deriveCheckoutGroupStatus(fresh.orders, fresh.payments, now);

    if (status === 'PAID' || status === 'PAID_AFTER_EXPIRY') {
      throw new AppException(
        409,
        'PAYMENT_RETRY_NOT_ALLOWED',
        'This checkout group has already been paid',
        { reason: 'ALREADY_PAID' },
      );
    }
    if (!canRetryFromStatus(status)) {
      // CANCELLED / PAYMENT_EXPIRED — giữ chỗ đã hết hạn hoặc đã bị thu hồi.
      throw new AppException(
        409,
        'PAYMENT_RETRY_NOT_ALLOWED',
        'The payment hold for this checkout group has expired',
        { reason: 'HOLD_EXPIRED' },
      );
    }

    const maxHoldAt = new Date(
      fresh.createdAt.getTime() + readPaymentMaxHoldMinutes() * 60_000,
    );
    if (now >= maxHoldAt) {
      throw new AppException(
        409,
        'PAYMENT_RETRY_NOT_ALLOWED',
        'Maximum hold time for this checkout group has been reached',
        { reason: 'HOLD_EXPIRED' },
      );
    }

    const latest = fresh.payments[0];
    if (status === 'AWAITING_PAYMENT' && latest.payUrl) {
      return {
        paymentUrl: latest.payUrl,
        expiresAt: latest.expiresAt.toISOString(),
        created: false,
      };
    }
    if (status === 'AWAITING_PAYMENT') {
      // payUrl rỗng (gọi cổng lỗi sau commit lần trước) — coi lần thử này như thất bại rồi tạo mới.
      await this.prisma.payment.updateMany({
        where: { id: latest.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    }

    const method = latest.method;
    const amountVnd = latest.amount.toNumber();
    const availability = this.paymentGateway.availabilityOf(method, amountVnd);
    if (!availability.available) {
      throw new AppException(
        409,
        'PAYMENT_METHOD_UNAVAILABLE',
        `Payment method ${method} is not available`,
        { method, reason: availability.reason! },
      );
    }
    const gateway = this.paymentGateway.getConfigured(method);
    if (!gateway) {
      throw new AppException(
        409,
        'PAYMENT_METHOD_UNAVAILABLE',
        `Payment method ${method} is not configured`,
        { method, reason: 'NOT_CONFIGURED' },
      );
    }

    const txnRef = generateTxnRef();
    const expiresAt = new Date(
      Math.min(
        now.getTime() + readPaymentTtlMinutes() * 60_000,
        maxHoldAt.getTime(),
      ),
    );
    await this.prisma.payment.create({
      data: {
        checkoutGroupId: groupId,
        method,
        amount: amountVnd,
        txnRef,
        expiresAt,
      },
    });
    const { payUrl } = await gateway.createPayment({
      txnRef,
      amountVnd,
      returnUrl: this.buildReturnUrl(method),
      expiresAt,
      locale: 'vi',
    });
    await this.prisma.payment.update({
      where: { txnRef },
      data: { payUrl },
    });
    return {
      paymentUrl: payUrl,
      expiresAt: expiresAt.toISOString(),
      created: true,
    };
  }

  private buildReturnUrl(method: PaymentMethod): string {
    const base = (
      process.env.API_PUBLIC_URL?.trim() || 'http://localhost:4000'
    ).replace(/\/+$/, '');
    return `${base}/api/v1/payments/${method.toLowerCase()}/return`;
  }

  private async loadGroupForOwner(
    userId: string,
    groupId: string,
  ): Promise<LoadedGroup> {
    const group = await this.prisma.checkoutGroup.findFirst({
      where: { id: groupId, userId },
      select: groupSelect,
    });
    if (!group) {
      throw new NotFoundException('Checkout group not found');
    }
    return group;
  }

  // Nếu lần thử mới nhất đã quá expiresAt + ân hạn mà nhóm chưa có Payment SUCCESS, tự thu hồi rồi
  // đọc lại — người gọi (getCheckoutGroup/retryPayment) không bao giờ thấy trạng thái đã hết hạn
  // thật mà vẫn hiện AWAITING_PAYMENT chỉ vì job (2.10) chưa kịp chạy.
  private async reclaimIfLapsedThenReload(
    group: LoadedGroup,
  ): Promise<LoadedGroup> {
    const latest = group.payments[0];
    const hasSuccess = group.payments.some((p) => p.status === 'SUCCESS');
    if (!latest || hasSuccess) return group;

    const graceMs = readPaymentReclaimGraceMinutes() * 60_000;
    const lapsed = Date.now() >= latest.expiresAt.getTime() + graceMs;
    if (!lapsed) return group;

    await this.reclaimCheckoutGroup(group.id);
    return this.loadGroupForOwner(group.userId, group.id);
  }

  private toView(group: LoadedGroup): CheckoutGroupView {
    const now = new Date();
    const status = deriveCheckoutGroupStatus(group.orders, group.payments, now);
    const latest = group.payments[0] ?? null;
    const totalAmount = group.orders.reduce(
      (sum, o) => sum + o.totalAmount.toNumber(),
      0,
    );
    return {
      id: group.id,
      status,
      canRetry: canRetryFromStatus(status),
      expiresAt: latest ? latest.expiresAt.toISOString() : null,
      createdAt: group.createdAt.toISOString(),
      totalAmount: String(totalAmount),
      paymentMethod: latest?.method ?? null,
      latestPaymentStatus: latest?.status ?? null,
      orders: group.orders.map((o) => ({
        id: o.id,
        shopId: o.shopId,
        shopName: o.shop.name,
        status: o.status,
        subtotal: String(
          o.totalAmount.toNumber() +
            o.discountAmount.toNumber() -
            o.shippingFee.toNumber(),
        ),
        discountAmount: o.discountAmount.toString(),
        shippingFee: o.shippingFee.toString(),
        totalAmount: o.totalAmount.toString(),
        items: o.items.map((item) => ({
          productName: item.productName,
          variantLabel: item.variantLabel,
          sku: item.sku,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          priceAtPurchase: item.priceAtPurchase.toString(),
        })),
      })),
    };
  }
}
