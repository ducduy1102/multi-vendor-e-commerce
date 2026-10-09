import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  RefundRequestKind,
  RefundRequestStatus,
} from '@prisma/client';
import { AppException } from '../../shared/exceptions/app.exception';
import type { OrderCancelledBy } from '../../shared/mail/templates/order-email.types';
import type {
  PaymentGateway,
  RefundResult,
} from '../../shared/payment/payment-gateway.interface';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import {
  lockGroupOrders,
  settleCodPayment,
  shouldReleaseVoucher,
} from './checkout-group-tx';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService, type OrderActor } from './order-status.service';
import {
  pickRefundablePayment,
  classifyAbnormalPayment,
  toRefundRef,
} from './refund-payment-rules';
import {
  readRefundGatewayTimeoutMs,
  REFUND_PENDING_STALE_MS,
} from './refund-config';
import { RefundRequestService } from './refund-request.service';

// Tóm tắt một khoản hoàn tiền (PaymentRefund) trả cho người gọi — controller (2.6/2.7/2.9) ánh xạ sang response.
export interface RefundSummary {
  id: string;
  status: PaymentRefundStatus;
  // Số tiền VND nguyên dạng chuỗi (cùng quy ước các response tiền khác).
  amount: string;
}

export interface RefundOrderOptions {
  // Lý do của người ra quyết định (hoặc người mua khi tự hủy): ghi vào Order timeline, PaymentRefund.reason
  // và RefundRequestHistory.note. Không có thì null — KHÔNG có chuỗi mặc định (note-nestjs.md BM).
  reason?: string | null;
  // Duyệt ĐÚNG yêu cầu này: bắt buộc yêu cầu còn mở (PENDING_SELLER/ESCALATED), nếu không cả giao dịch rollback
  // (vd người mua vừa rút yêu cầu) — đơn không bị hủy oan. Bỏ trống ⇒ tự đóng yêu cầu cùng loại đang mở của đơn
  // (nếu có), dùng cho seller tự hủy đơn trực tiếp.
  refundRequestId?: string;
  // Thu hẹp các trạng thái đơn được phép đi so với mặc định của loại thao tác (hủy: PENDING/CONFIRMED/PACKED).
  // RefundService không biết người gọi là ai nên KHÔNG tự phân biệt "hủy ngay" với "seller tự hủy": người gọi
  // phải nói rõ. Hủy ngay của buyer / seller từ chối chỉ được khi shop CHƯA xác nhận (['PENDING']) — nếu không,
  // đơn vừa được shop xác nhận giữa lúc kiểm và lúc hủy vẫn bị hủy mà không cần shop đồng ý (đáng ra buyer phải
  // gửi yêu cầu hủy). Trạng thái lệch lúc đọc ⇒ ORDER_INVALID_TRANSITION, lệch lúc đã khoá ⇒ ORDER_ALREADY_CHANGED.
  onlyFrom?: readonly OrderStatus[];
}

export interface OrderRefundResult {
  // null = không có khoản hoàn qua cổng (đơn COD, hoặc đơn 0đ).
  refund: RefundSummary | null;
}

interface OrderRefundPlan {
  kind: RefundRequestKind;
  from: readonly OrderStatus[];
  to: OrderStatus;
}

// Hủy TRƯỚC giao: kho cộng lại, voucher có thể trả. PENDING = shop chưa xác nhận (hủy ngay), CONFIRMED/PACKED =
// seller tự hủy hoặc duyệt yêu cầu hủy của người mua (Week9.md 1.3). SHIPPING KHÔNG có trong danh sách.
const CANCEL_PLAN: OrderRefundPlan = {
  kind: 'CANCEL',
  from: ['PENDING', 'CONFIRMED', 'PACKED'],
  to: 'CANCELLED',
};
// Trả hàng SAU giao: không cộng kho (hàng chưa kiểm), không trả voucher (đã dùng thật).
const RETURN_PLAN: OrderRefundPlan = {
  kind: 'RETURN',
  from: ['COMPLETED'],
  to: 'REFUNDED',
};

const OPEN_REQUEST_STATUSES: readonly RefundRequestStatus[] = [
  'PENDING_SELLER',
  'ESCALATED',
];

const REFUND_REASON_MAX_LENGTH = 500;

// Lý do ghi vào PaymentRefund.failureReason khi RefundJob bỏ cuộc (Admin đọc ở màn hoàn tiền lỗi). "Cổng chưa bao giờ
// xác nhận" KHÔNG có nghĩa tiền chưa đi: phản hồi có thể đã mất sau khi cổng nhận yêu cầu (VNPay trả "Request is
// duplicated" cho mã yêu cầu đã thấy) — nên nhắc kiểm tra trên cổng TRƯỚC khi hoàn tay, tránh hoàn hai lần.
const EXHAUSTED_ATTEMPTS_REASON =
  'Automatic retries exhausted: the payment gateway never confirmed this refund; check the gateway before refunding manually, the request may already have been accepted';

const refundOrderSelect = {
  id: true,
  status: true,
  checkoutGroupId: true,
  totalAmount: true,
  items: { select: { productVariantId: true, quantity: true } },
  checkoutGroup: {
    select: {
      payments: {
        select: {
          id: true,
          method: true,
          status: true,
          paidAt: true,
          amount: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type RefundableOrder = Prisma.OrderGetPayload<{
  select: typeof refundOrderSelect;
}>;

const refundSummarySelect = {
  id: true,
  status: true,
  amount: true,
} satisfies Prisma.PaymentRefundSelect;

type RefundTarget =
  | { kind: 'COD' }
  | { kind: 'ONLINE'; payment: { id: string; amount: Prisma.Decimal } };

class RefundGatewayTimeoutError extends Error {
  constructor(ms: number) {
    super(`Payment gateway did not answer the refund within ${ms}ms`);
    this.name = 'RefundGatewayTimeoutError';
  }
}

// Chờ `promise` tối đa `ms`. Hết hạn ⇒ reject; lời gọi cổng vẫn có thể chạy tiếp nền nhưng kết quả muộn bị bỏ
// (mã tham chiếu ổn định + RefundJob/Admin thử lại an toàn).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefundGatewayTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const normaliseNote = (value: string | null | undefined): string | null =>
  value?.trim() || null;

const toSummary = (row: {
  id: string;
  status: PaymentRefundStatus;
  amount: Prisma.Decimal;
}): RefundSummary => ({
  id: row.id,
  status: row.status,
  amount: row.amount.toString(),
});

const isStalePending = (updatedAt: Date): boolean =>
  Date.now() - updatedAt.getTime() >= REFUND_PENDING_STALE_MS;

// Người nhận email "đơn bị hủy" thấy ai là người hủy: yêu cầu của người mua được duyệt ⇒ "theo yêu cầu của bạn".
function cancelledByOf(
  actor: OrderActor,
  closedRequest: boolean,
): OrderCancelledBy {
  if (closedRequest || actor.type === 'BUYER') return 'BUYER';
  return actor.type === 'SELLER' ? 'SELLER' : 'SYSTEM';
}

const orderNotFound = () =>
  new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');

const orderInvalidTransition = (status: OrderStatus) =>
  new AppException(
    409,
    'ORDER_INVALID_TRANSITION',
    `Action is not allowed while the order is ${status}`,
  );

const orderAlreadyChanged = () =>
  new AppException(
    409,
    'ORDER_ALREADY_CHANGED',
    'Order status was changed by another request',
  );

const paymentNotRefundable = (message: string) =>
  new AppException(409, 'PAYMENT_NOT_REFUNDABLE', message);

const refundNotFound = () =>
  new AppException(404, 'PAYMENT_REFUND_NOT_FOUND', 'Refund not found');

const refundNotRetryable = () =>
  new AppException(
    409,
    'PAYMENT_REFUND_NOT_RETRYABLE',
    'Refund is not in a state that can be retried or completed manually',
  );

// Lõi hủy/hoàn tiền (Week9.md 1.2/1.5/1.7). KHÔNG biết người gọi là buyer/seller/Admin cụ thể — nhận `actor`
// như OrderStatusService, việc "ai được làm gì" và phạm vi (đơn của ai) là của controller/service gọi tới, để
// Tuần 11 (Admin hủy hàng loạt đơn của shop bị khoá) dùng lại nguyên trạng.
//
// Hủy có HIỆU LỰC NGAY (trạng thái đơn, kho, voucher), tiền chạy theo sau và có thể chậm/lỗi — gắn hai việc làm
// một sẽ để lỗi cổng giữ hàng và voucher làm con tin, còn gọi mạng khi đang giữ khoá dòng sẽ kéo dài khoá:
//   Tx1  (một transaction, nhánh online): khoá Payment → đơn cả nhóm (id↑) → variant (id↑) → voucher; lật
//        trạng thái, cộng kho, nhả voucher, tạo PaymentRefund PENDING, đóng yêu cầu. Cùng thứ tự khoá với
//        PaymentService.confirmSuccess nên hủy đồng thời với IPN tới trễ xếp hàng chứ không deadlock.
//   Gọi cổng NGOÀI transaction, đồng bộ nhưng có giới hạn thời gian — quá hạn/lỗi ⇒ giữ PENDING, job lo tiếp.
//   Tx2  (finaliseRefund): chốt PENDING → SUCCEEDED/FAILED bằng UPDATE có điều kiện `status = 'PENDING'` (ổ khoá
//        idempotent), cộng Payment.refundedAmount (kèm CHECK DB), Payment → REFUNDED khi hoàn đủ.
// Đơn COD không có tiền đi qua cổng nên không có PaymentRefund (hoàn tiền mặt ngoài hệ thống, Week9.md 1.4).
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService,
    private readonly inventoryService: InventoryService,
    private readonly voucherUsageService: VoucherUsageService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly refundRequestService: RefundRequestService,
    private readonly orderEmailService: OrderEmailService,
  ) {}

  // --- Hủy / trả hàng theo đơn ----------------------------------------------------------------

  // Hủy đơn TRƯỚC giao (PENDING/CONFIRMED/PACKED): hủy ngay của buyer, seller hủy/từ chối, duyệt yêu cầu hủy.
  // Đơn đã trả online ⇒ hoàn tiền về nguồn thanh toán (saga ở trên); đơn COD ⇒ chỉ đổi trạng thái + kho + voucher.
  async cancelOrderWithRefund(
    actor: OrderActor,
    orderId: string,
    options: RefundOrderOptions = {},
  ): Promise<OrderRefundResult> {
    const outcome = await this.refundOrder(
      CANCEL_PLAN,
      actor,
      orderId,
      options,
    );

    // Email SAU commit, nói "đang hoàn tiền" chứ không khẳng định đã hoàn (cổng có thể chậm hoặc lỗi).
    await this.orderEmailService.notifyCancelled(
      { orderIds: [orderId] },
      cancelledByOf(actor, outcome.closedRequest),
      normaliseNote(options.reason),
      outcome.refund ? Number(outcome.refund.amount) : null,
    );
    return { refund: outcome.refund };
  }

  // Duyệt trả hàng/hoàn tiền SAU giao: COMPLETED → REFUNDED. Không cộng kho (hàng chưa về/chưa kiểm), không trả
  // voucher (đã dùng thật). Email "đã hoàn tiền" làm ở 5.3 (cần hạ tầng locale).
  async refundReturnedOrder(
    actor: OrderActor,
    orderId: string,
    options: RefundOrderOptions = {},
  ): Promise<OrderRefundResult> {
    const outcome = await this.refundOrder(
      RETURN_PLAN,
      actor,
      orderId,
      options,
    );
    return { refund: outcome.refund };
  }

  // Dùng chung cho hủy / trả hàng: chỉ khác danh sách trạng thái đi, trạng thái đích và tác dụng phụ kho/voucher.
  private async refundOrder(
    plan: OrderRefundPlan,
    actor: OrderActor,
    orderId: string,
    options: RefundOrderOptions,
  ): Promise<{ refund: RefundSummary | null; closedRequest: boolean }> {
    // Đọc trước (không khoá) để biết nhánh và khoá ĐÚNG Payment; trạng thái đơn được kiểm lại SAU khi khoá.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: refundOrderSelect,
    });
    if (!order) throw orderNotFound();
    const allowedFrom = options.onlyFrom
      ? plan.from.filter((status) => options.onlyFrom?.includes(status))
      : plan.from;
    if (!allowedFrom.includes(order.status)) {
      throw orderInvalidTransition(order.status);
    }
    const target = this.resolveTarget(order);
    const note = normaliseNote(options.reason);

    const committed = await this.prisma.$transaction(async (tx) => {
      if (target.kind === 'ONLINE') {
        const locked = await this.lockPayment(tx, target.payment.id);
        if (locked.status !== 'SUCCESS') {
          throw paymentNotRefundable('Payment is no longer refundable');
        }
      }
      const group = await lockGroupOrders(tx, order.checkoutGroupId);
      const current = group.find((o) => o.id === order.id);
      if (!current) throw orderNotFound();
      // Lúc đọc trước khoá đơn còn ở trạng thái hợp lệ nhưng giờ đã khác ⇒ thua race (ORDER_ALREADY_CHANGED, khác
      // ORDER_INVALID_TRANSITION của lần kiểm đầu: người dùng cần tải lại trang).
      if (!allowedFrom.includes(current.status)) {
        throw orderAlreadyChanged();
      }

      const flipped = await this.orderStatusService.transition(
        tx,
        [order.id],
        current.status,
        plan.to,
        actor,
        note ?? undefined,
      );
      if (flipped.length === 0) throw orderAlreadyChanged();

      if (plan.kind === 'CANCEL') {
        await this.applyCancellationEffects(tx, order);
      }

      const request = await this.findRequestToClose(
        tx,
        order.id,
        plan.kind,
        options.refundRequestId,
      );

      let refund: RefundSummary | null = null;
      if (target.kind === 'ONLINE') {
        refund = await this.createRefundRow(tx, {
          paymentId: target.payment.id,
          paymentAmount: target.payment.amount,
          orderId: order.id,
          amount: order.totalAmount,
          refundRequestId: request?.id ?? null,
          reason: note,
          actor,
        });
      } else {
        // Nhóm COD: tính lại số phận Payment COD ở MỌI đường đưa đơn tới đích (note-nestjs.md BL).
        await settleCodPayment(tx, order.checkoutGroupId);
      }

      if (request) {
        await this.refundRequestService.transition(
          tx,
          request.id,
          request.status,
          'APPROVED',
          actor,
          note,
        );
      }
      return { refund, closedRequest: request !== null };
    });

    const refund = committed.refund
      ? await this.tryExecuteRefund(committed.refund)
      : null;
    return { refund, closedRequest: committed.closedRequest };
  }

  // Tác dụng phụ của việc hủy TRƯỚC giao lên kho và voucher, trong transaction của người gọi (đã lật được trạng
  // thái đơn): cộng lại stock vật lý — đơn đã chốt kho nên dùng `restock`, KHÔNG phải `release` (note-nestjs.md
  // AW; restock vô điều kiện nên CHỈ gọi sau khi UPDATE có điều kiện đã lật được đơn, AU) — rồi trả lượt voucher
  // nếu nhóm không còn đơn nào hưởng giảm giá. Dùng chung với OrderActionService (đường hủy đơn COD).
  async applyCancellationEffects(
    tx: TxClient,
    order: {
      checkoutGroupId: string;
      items: { productVariantId: string; quantity: number }[];
    },
  ): Promise<void> {
    await this.inventoryService.restock(
      tx,
      order.items.map((item) => ({
        productVariantId: item.productVariantId,
        quantity: item.quantity,
      })),
    );
    await this.releaseVoucherIfFullyCancelled(tx, order.checkoutGroupId);
  }

  // Trả lượt voucher của nhóm khi MỌI đơn đang hưởng giảm giá đã bị hủy trước giao (Week9.md 1.7). Idempotent nhờ
  // `releasedAt` của VoucherUsageService.release; đứng CUỐI thứ tự khoá (đơn → variant → voucher). Người gọi phải
  // đã khoá cả nhóm (lockGroupOrders) để hai đơn của nhóm hủy đồng thời nhìn thấy nhau — nếu không cả hai cùng
  // thấy "đơn kia còn sống" và không ai trả lượt (write skew, note-nestjs.md AV).
  async releaseVoucherIfFullyCancelled(
    tx: TxClient,
    checkoutGroupId: string,
  ): Promise<boolean> {
    const orders = await tx.order.findMany({
      where: { checkoutGroupId },
      select: { status: true, discountAmount: true },
    });
    const shouldRelease = shouldReleaseVoucher(
      orders.map((order) => ({
        status: order.status,
        discountAmount: order.discountAmount.toNumber(),
      })),
    );
    if (!shouldRelease) return false;
    return (await this.voucherUsageService.release(tx, checkoutGroupId)) > 0;
  }

  // Nhóm COD ⇒ không có cổng; nhóm online ⇒ khoản SUCCESS sớm nhất (khoản thứ hai của ca thanh toán trùng chỉ
  // hoàn qua refundPayment). Nhóm online chưa thu được đồng nào ⇒ không có gì để hoàn.
  private resolveTarget(order: RefundableOrder): RefundTarget {
    const payments = order.checkoutGroup.payments;
    if (payments.some((p) => p.method === 'COD')) return { kind: 'COD' };
    const payment = pickRefundablePayment(payments);
    if (!payment) {
      throw paymentNotRefundable('There is no successful payment to refund');
    }
    return {
      kind: 'ONLINE',
      payment: { id: payment.id, amount: payment.amount },
    };
  }

  // Yêu cầu hủy/trả hàng ĐANG MỞ của đơn cần đóng (APPROVED) cùng giao dịch. Có `requestId` ⇒ BẮT BUỘC đúng yêu
  // cầu đó và còn mở (fail-closed); không có ⇒ lấy yêu cầu mở cùng loại của đơn (index duy nhất từng phần đảm bảo
  // tối đa một), có thể không có.
  private async findRequestToClose(
    tx: TxClient,
    orderId: string,
    kind: RefundRequestKind,
    requestId: string | undefined,
  ): Promise<{ id: string; status: RefundRequestStatus } | null> {
    const request = await tx.refundRequest.findFirst({
      where: requestId
        ? { id: requestId, orderId, kind }
        : { orderId, kind, status: { in: [...OPEN_REQUEST_STATUSES] } },
      select: { id: true, status: true },
    });
    if (
      requestId &&
      (!request || !OPEN_REQUEST_STATUSES.includes(request.status))
    ) {
      throw new AppException(
        409,
        'REFUND_REQUEST_INVALID_TRANSITION',
        'Refund request is no longer open',
      );
    }
    return request;
  }

  // --- Thanh toán bất thường (chỉ chuyển tiền) -------------------------------------------------

  // Admin hoàn TOÀN BỘ một khoản thanh toán bất thường (PAID_AFTER_EXPIRY hoặc thanh toán trùng, Week9.md 1.9):
  // PaymentRefund với orderId = NULL. CHỈ chuyển tiền — không cộng kho, không nhả voucher (nhóm đã được
  // reclaimCheckoutGroup xử lý, hoặc đơn vẫn sống ở ca trùng). Payment đã có bất kỳ dòng hoàn nào (kể cả FAILED)
  // thì không tạo thêm: dùng retry / ghi nhận thủ công trên dòng đó, tránh hoàn hai lần cùng một khoản tiền.
  async refundPayment(
    actor: OrderActor,
    paymentId: string,
    reason?: string | null,
  ): Promise<RefundSummary> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, checkoutGroupId: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const note = normaliseNote(reason);

    const created = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockPayment(tx, paymentId);
      if (locked.status !== 'SUCCESS') {
        throw paymentNotRefundable('Payment is not in a refundable state');
      }
      const orders = await lockGroupOrders(tx, payment.checkoutGroupId);
      const groupPayments = await tx.payment.findMany({
        where: { checkoutGroupId: payment.checkoutGroupId },
        select: { id: true, status: true, method: true, paidAt: true },
      });
      const kind = classifyAbnormalPayment({
        paymentId,
        groupPayments,
        orderStatuses: orders.map((order) => order.status),
      });
      if (!kind) {
        throw paymentNotRefundable(
          'Only a late or duplicate payment can be refunded without an order',
        );
      }
      if ((await tx.paymentRefund.count({ where: { paymentId } })) > 0) {
        throw paymentNotRefundable(
          'This payment already has refund records; retry or complete them instead',
        );
      }

      const summary = await this.createRefundRow(tx, {
        paymentId,
        paymentAmount: locked.amount,
        orderId: null,
        amount: locked.amount,
        refundRequestId: null,
        reason: note,
        actor,
      });
      if (!summary) throw paymentNotRefundable('Payment has nothing to refund');
      return summary;
    });

    return this.tryExecuteRefund(created);
  }

  // --- Sổ cái: tạo, gọi cổng, chốt -------------------------------------------------------------

  // Tạo dòng PaymentRefund PENDING trong transaction của người gọi, ĐÃ giữ khoá dòng Payment — nên tổng các khoản
  // hoàn chưa-FAILED + khoản này ≤ Payment.amount được kiểm đúng (hai hoàn tiền đồng thời cùng Payment xếp hàng ở
  // khoá). Đơn 0đ (voucher phủ hết) ⇒ không có tiền để hoàn, trả null.
  private async createRefundRow(
    tx: TxClient,
    params: {
      paymentId: string;
      paymentAmount: Prisma.Decimal;
      orderId: string | null;
      amount: Prisma.Decimal;
      refundRequestId: string | null;
      reason: string | null;
      actor: OrderActor;
    },
  ): Promise<RefundSummary | null> {
    if (params.amount.lte(0)) return null;
    await this.assertWithinPayment(
      tx,
      params.paymentId,
      params.paymentAmount,
      params.amount,
    );

    const created = await tx.paymentRefund.create({
      data: {
        paymentId: params.paymentId,
        orderId: params.orderId,
        refundRequestId: params.refundRequestId,
        amount: params.amount,
        status: 'PENDING',
        reason: params.reason?.slice(0, REFUND_REASON_MAX_LENGTH) ?? null,
        initiatedByType: params.actor.type,
        initiatedById: params.actor.type === 'SYSTEM' ? null : params.actor.id,
      },
      select: refundSummarySelect,
    });
    return toSummary(created);
  }

  // Tổng các khoản hoàn CHƯA FAILED của Payment + `amount` không vượt số đã thu. Gọi khi đang giữ khoá Payment.
  private async assertWithinPayment(
    tx: TxClient,
    paymentId: string,
    paymentAmount: Prisma.Decimal,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const { _sum } = await tx.paymentRefund.aggregate({
      where: { paymentId, status: { not: 'FAILED' } },
      _sum: { amount: true },
    });
    const committed = _sum.amount ?? new Prisma.Decimal(0);
    if (committed.plus(amount).gt(paymentAmount)) {
      throw paymentNotRefundable('Refund would exceed the amount paid');
    }
  }

  // Gọi cổng cho một khoản hoàn rồi chốt kết quả — dùng cho request vừa tạo, Admin thử lại và RefundJob. Lỗi bất
  // ngờ của cổng KHÔNG ném ra (coi như PENDING, thử lại bằng cùng mã tham chiếu); chỉ lỗi DB mới ném.
  async executeRefund(refundId: string): Promise<RefundSummary> {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        status: true,
        amount: true,
        payment: {
          select: {
            method: true,
            txnRef: true,
            transactionId: true,
            gatewayPaidAt: true,
            amount: true,
          },
        },
      },
    });
    if (!refund) throw refundNotFound();
    if (refund.status !== 'PENDING') return toSummary(refund);

    const gateway = this.paymentGateway.get(refund.payment.method);
    if (!gateway) {
      return this.finaliseRefund(refundId, {
        outcome: 'FAILED',
        gatewayRef: null,
        failureReason: `No payment gateway is available for ${refund.payment.method}`,
      });
    }

    // Mỗi lần gọi cổng tính một lần thử và làm mới updatedAt (RefundJob dựa vào để giãn các lần quét). Cập nhật
    // có điều kiện nên nếu khoản hoàn đã được chốt ở nơi khác thì không gọi cổng nữa.
    const { count } = await this.prisma.paymentRefund.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) return this.currentSummary(refundId);

    const result = await this.callGateway(gateway, {
      refundRef: toRefundRef(refundId),
      txnRef: refund.payment.txnRef,
      gatewayTransactionId: refund.payment.transactionId,
      gatewayPaidAt: refund.payment.gatewayPaidAt,
      amountVnd: refund.amount.toNumber(),
      paymentAmountVnd: refund.payment.amount.toNumber(),
      reason: 'Order refund',
    });
    return this.finaliseRefund(refundId, result);
  }

  private async callGateway(
    gateway: PaymentGateway,
    params: Parameters<PaymentGateway['refund']>[0],
  ): Promise<RefundResult> {
    try {
      return await withTimeout(
        gateway.refund(params),
        readRefundGatewayTimeoutMs(),
      );
    } catch (error) {
      // Timeout / mạng / cấu hình: chưa biết cổng đã nhận yêu cầu hay chưa ⇒ PENDING (thà chờ hơn kết luận sai).
      this.logger.warn(
        `Refund ${params.refundRef} left PENDING: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { outcome: 'PENDING', gatewayRef: null, failureReason: null };
    }
  }

  // Sau commit Tx1: gọi cổng nhưng KHÔNG để lỗi làm hỏng request — DB đã xong việc hủy, khoản hoàn vẫn PENDING
  // trong sổ cái và RefundJob/Admin sẽ chạy tiếp (rules/backend.md mục 4).
  private async tryExecuteRefund(
    initial: RefundSummary,
  ): Promise<RefundSummary> {
    try {
      return await this.executeRefund(initial.id);
    } catch (error) {
      this.logger.error(
        `Refund ${initial.id} could not be executed after the order was updated: ${error instanceof Error ? error.message : String(error)}`,
      );
      return initial;
    }
  }

  // Tx2: chốt kết quả cổng cho một khoản hoàn. Idempotent nhờ UPDATE có điều kiện `status = 'PENDING'` — gọi lặp
  // (job + request cùng lúc) chỉ một bên thắng và cộng tiền đúng một lần. PENDING (cổng chưa trả lời) không ghi gì.
  // FAILED KHÔNG hoàn tác việc hủy (kho/voucher/trạng thái đơn đã đúng): Admin thử lại hoặc ghi nhận thủ công.
  finaliseRefund(
    refundId: string,
    result: RefundResult,
  ): Promise<RefundSummary> {
    return this.settleRefund(refundId, result, ['PENDING']);
  }

  private async settleRefund(
    refundId: string,
    result: RefundResult,
    successFrom: readonly PaymentRefundStatus[],
  ): Promise<RefundSummary> {
    const head = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: { ...refundSummarySelect, paymentId: true },
    });
    if (!head) throw refundNotFound();
    if (result.outcome === 'PENDING') return toSummary(head);

    const settled = await this.prisma.$transaction(async (tx) => {
      // Khoá Payment TRƯỚC (cùng thứ tự Payment → … của Tx1) để chốt và các lần hủy/hoàn khác của cùng Payment
      // xếp hàng chứ không chờ vòng nhau.
      await this.lockPayment(tx, head.paymentId);

      let failedNow = false;
      if (result.outcome === 'SUCCESS') {
        const { count } = await tx.paymentRefund.updateMany({
          where: { id: refundId, status: { in: [...successFrom] } },
          data: {
            status: 'SUCCEEDED',
            gatewayRef: result.gatewayRef,
            failureReason: null,
            completedAt: new Date(),
          },
        });
        if (count === 1) {
          await this.applyRefundToPayment(tx, head.paymentId, head.amount);
        }
      } else {
        const { count } = await tx.paymentRefund.updateMany({
          where: { id: refundId, status: 'PENDING' },
          data: {
            status: 'FAILED',
            failureReason: (
              result.failureReason ??
              'Refund was rejected by the payment gateway'
            ).slice(0, REFUND_REASON_MAX_LENGTH),
          },
        });
        failedNow = count === 1;
      }

      const fresh = await tx.paymentRefund.findUniqueOrThrow({
        where: { id: refundId },
        select: refundSummarySelect,
      });
      return { summary: toSummary(fresh), failedNow };
    });

    if (settled.failedNow) {
      this.logger.error(
        `Refund ${refundId} was rejected by the gateway: ${result.failureReason ?? 'no reason given'} — admin must retry or complete it manually`,
      );
    }
    return settled.summary;
  }

  // Cộng khoản hoàn đã thành công vào Payment bằng MỘT câu UPDATE có điều kiện: không bao giờ vượt `amount` (CHECK
  // DB là chốt chặn thứ hai) và đặt REFUNDED đúng khi hoàn đủ — hoàn một phần (nhóm nhiều đơn, hủy một đơn) vẫn
  // SUCCESS. 0 dòng ⇒ bất biến vỡ ⇒ ném để rollback cả việc chốt (khoản hoàn ở lại PENDING cho Admin xem xét).
  private async applyRefundToPayment(
    tx: TxClient,
    paymentId: string,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const value = amount.toString();
    const affected = await tx.$executeRaw`
      UPDATE payments
      SET refunded_amount = refunded_amount + ${value}::numeric,
          status = CASE
            WHEN refunded_amount + ${value}::numeric >= amount THEN 'REFUNDED'::"PaymentStatus"
            ELSE status
          END
      WHERE id = ${paymentId}
        AND status = 'SUCCESS'::"PaymentStatus"
        AND refunded_amount + ${value}::numeric <= amount`;
    if (affected !== 1) {
      throw paymentNotRefundable('Refund exceeds the amount paid');
    }
  }

  // --- RefundJob: hết lượt thử tự động ---------------------------------------------------------

  // Khoản hoàn PENDING bị bỏ dở mà ĐÃ dùng hết `maxAttempts` lần gọi cổng ⇒ FAILED kèm lý do để Admin thử lại
  // hoặc ghi nhận đã hoàn thủ công (Week9.md 1.5) — không treo PENDING mãi. KHÔNG hoàn tác việc hủy (như mọi
  // FAILED khác). Trả true khi lần này thật sự đánh dấu.
  //
  // MỘT câu UPDATE có điều kiện thay vì đọc-rồi-ghi, và điều kiện lặp lại cả `attempts` lẫn "bị bỏ dở" (updatedAt
  // đủ cũ): nếu Admin vừa thử lại (executeRefund tăng attempts và làm mới updatedAt TRƯỚC khi gọi cổng) thì lần
  // gọi đó coi như đang chạy, không bị đánh FAILED giữa chừng — nếu không cổng hoàn thật nhưng sổ cái ghi FAILED.
  // Không khoá Payment: câu lệnh chỉ chạm đúng một dòng payment_refunds nên không thể vòng chờ với đường khác.
  async failExhaustedRefund(
    refundId: string,
    maxAttempts: number,
  ): Promise<boolean> {
    const { count } = await this.prisma.paymentRefund.updateMany({
      where: {
        id: refundId,
        status: 'PENDING',
        attempts: { gte: maxAttempts },
        updatedAt: { lt: new Date(Date.now() - REFUND_PENDING_STALE_MS) },
      },
      data: { status: 'FAILED', failureReason: EXHAUSTED_ATTEMPTS_REASON },
    });
    if (count === 0) return false;

    this.logger.error(
      `Refund ${refundId} is still unconfirmed after ${maxAttempts} automatic attempt(s) — admin must retry or complete it manually`,
    );
    return true;
  }

  // --- Admin: thử lại / ghi nhận thủ công ------------------------------------------------------

  // Thử lại một khoản hoàn lỗi (FAILED) hoặc bị bỏ dở (PENDING quá REFUND_PENDING_STALE_MS). Dùng LẠI cùng dòng
  // (orderId unique) và cùng mã tham chiếu nên cổng không hoàn hai lần; FAILED → PENDING đi qua kiểm tổng lại vì
  // dòng FAILED không được tính khi một khoản hoàn khác (vd hoàn thanh toán bất thường) đã vào sau nó.
  async retryRefund(
    actor: OrderActor,
    refundId: string,
  ): Promise<RefundSummary> {
    const head = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: { paymentId: true },
    });
    if (!head) throw refundNotFound();

    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, head.paymentId);
      const refund = await tx.paymentRefund.findUniqueOrThrow({
        where: { id: refundId },
        select: { status: true, amount: true, updatedAt: true },
      });

      if (refund.status === 'FAILED') {
        if (payment.status !== 'SUCCESS') {
          throw paymentNotRefundable('Payment is no longer refundable');
        }
        await this.assertWithinPayment(
          tx,
          head.paymentId,
          payment.amount,
          refund.amount,
        );
        const { count } = await tx.paymentRefund.updateMany({
          where: { id: refundId, status: 'FAILED' },
          data: { status: 'PENDING', failureReason: null },
        });
        if (count === 0) throw refundNotRetryable();
      } else if (
        refund.status !== 'PENDING' ||
        !isStalePending(refund.updatedAt)
      ) {
        throw refundNotRetryable();
      }
    });

    this.logger.log(
      `Refund ${refundId} retried by ${actor.type === 'SYSTEM' ? 'system' : `${actor.type} ${actor.id}`}`,
    );
    return this.executeRefund(refundId);
  }

  // Admin xác nhận đã hoàn tiền ngoài hệ thống (vd trên trang merchant của cổng): ghi SUCCEEDED với
  // gatewayRef = 'MANUAL:' + mã tham chiếu. Cùng điều kiện đầu vào với retry (FAILED hoặc PENDING bỏ dở) để
  // không đua với một lần gọi cổng đang chạy. Idempotent: gọi lại với cùng mã trả đúng kết quả cũ, không cộng
  // tiền lần hai; đã SUCCEEDED bằng cách khác ⇒ 409.
  async markRefundCompleted(
    actor: OrderActor,
    refundId: string,
    reference: string,
  ): Promise<RefundSummary> {
    const ref = reference.trim();
    if (!ref) {
      // Lỗi lập trình của nơi gọi (DTO đã bắt buộc mã tham chiếu), không phải lỗi người dùng.
      throw new Error('A reference is required to complete a refund manually');
    }
    const gatewayRef = `MANUAL:${ref}`;

    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: { ...refundSummarySelect, gatewayRef: true, updatedAt: true },
    });
    if (!refund) throw refundNotFound();
    if (refund.status === 'SUCCEEDED') {
      if (refund.gatewayRef === gatewayRef) return toSummary(refund);
      throw refundNotRetryable();
    }
    if (refund.status === 'PENDING' && !isStalePending(refund.updatedAt)) {
      throw refundNotRetryable();
    }

    const summary = await this.settleRefund(
      refundId,
      { outcome: 'SUCCESS', gatewayRef, failureReason: null },
      ['PENDING', 'FAILED'],
    );
    this.logger.log(
      `Refund ${refundId} completed manually by ${actor.type === 'SYSTEM' ? 'system' : `${actor.type} ${actor.id}`}`,
    );
    return summary;
  }

  // --- Dùng chung -----------------------------------------------------------------------------

  private async currentSummary(refundId: string): Promise<RefundSummary> {
    const row = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: refundSummarySelect,
    });
    if (!row) throw refundNotFound();
    return toSummary(row);
  }

  // Khoá đúng dòng Payment và trả trạng thái + số tiền ĐỌC SAU KHI KHOÁ. Mọi đường hoàn tiền khoá Payment
  // TRƯỚC khi khoá đơn / ghi sổ cái (cùng thứ tự với PaymentService.confirmSuccess).
  private async lockPayment(
    tx: TxClient,
    paymentId: string,
  ): Promise<{ status: PaymentStatus; amount: Prisma.Decimal }> {
    const rows = await tx.$queryRaw<
      { status: PaymentStatus; amount: string }[]
    >`
      SELECT status, amount::text AS amount FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Payment not found');
    return {
      status: rows[0].status,
      amount: new Prisma.Decimal(rows[0].amount),
    };
  }
}
