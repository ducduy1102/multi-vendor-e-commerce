import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ORDER_LIST_PREVIEW_ITEMS,
  type AdminRefund,
  type AdminRefundListQuery,
  type AdminRefundListResponse,
  type AdminRefundRequest,
  type AdminRefundRequestListQuery,
  type AdminRefundRequestListResponse,
  type AdminRefundablePayment,
  type AdminRefundablePaymentListQuery,
  type AdminRefundablePaymentListResponse,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  getAdminRefundActions,
  getAdminRefundRequestActions,
} from './order-actions';
import { itemSelect, refundRequestFields } from './order-query.service';
import { REFUND_PENDING_STALE_MS } from './refund-config';
import { classifyAbnormalPayment } from './refund-payment-rules';

// Số tiền VND luôn là chuỗi số nguyên đồng trong response (cùng quy ước OrderQueryService).
const money = (value: Prisma.Decimal): string => String(value.toNumber());

const buyerSelect = { select: { name: true, email: true } } as const;

// Yêu cầu đầy đủ + tóm tắt đơn cho Admin. Route chỉ ADMIN gọi được nên được kèm email người mua; history vẫn
// dùng refundRequestFields (không actorId) — Admin chỉ cần biết LOẠI người đã làm, không cần định danh.
const adminRequestSelect = {
  ...refundRequestFields,
  shop: { select: { id: true, name: true } },
  user: buyerSelect,
  order: {
    select: {
      id: true,
      status: true,
      totalAmount: true,
      recipientName: true,
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
      paymentRefund: { select: { status: true, amount: true } },
    },
  },
} satisfies Prisma.RefundRequestSelect;

// Sổ cái hoàn tiền cho Admin: kèm lý do LỖI nội bộ của cổng, mã giao dịch để đối chiếu/hoàn thủ công và người
// mua (qua nhóm thanh toán — Payment không có quan hệ trực tiếp tới User).
const adminRefundSelect = {
  id: true,
  status: true,
  amount: true,
  attempts: true,
  reason: true,
  failureReason: true,
  gatewayRef: true,
  initiatedByType: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  payment: {
    select: {
      id: true,
      method: true,
      status: true,
      amount: true,
      refundedAmount: true,
      txnRef: true,
      transactionId: true,
      checkoutGroup: { select: { user: buyerSelect } },
    },
  },
  order: {
    select: {
      id: true,
      status: true,
      totalAmount: true,
      recipientName: true,
    },
  },
} satisfies Prisma.PaymentRefundSelect;

// Chi tiết một khoản thanh toán bất thường: cả các Payment và đơn của nhóm, để phân loại lại bằng ĐÚNG hàm
// classifyAbnormalPayment mà RefundService.refundPayment kiểm khi thực thi.
const refundablePaymentSelect = {
  id: true,
  method: true,
  amount: true,
  paidAt: true,
  txnRef: true,
  transactionId: true,
  checkoutGroupId: true,
  checkoutGroup: {
    select: {
      user: buyerSelect,
      payments: {
        select: { id: true, status: true, method: true, paidAt: true },
      },
      orders: {
        select: { id: true, status: true, totalAmount: true },
        orderBy: { id: 'asc' },
      },
    },
  },
} satisfies Prisma.PaymentSelect;

type LoadedAdminRequest = Prisma.RefundRequestGetPayload<{
  select: typeof adminRequestSelect;
}>;
type LoadedAdminRefund = Prisma.PaymentRefundGetPayload<{
  select: typeof adminRefundSelect;
}>;
type LoadedRefundablePayment = Prisma.PaymentGetPayload<{
  select: typeof refundablePaymentSelect;
}>;

// Điều kiện SQL của "thanh toán cần hoàn" (Week9.md 1.9) — SQL thô vì Prisma không so sánh được một dòng với
// các dòng cùng nhóm (DUPLICATE: có Payment SUCCESS khác của nhóm đến TRƯỚC). Hai nhánh khớp từng chữ với
// classifyAbnormalPayment/pickRefundablePayment (refund-payment-rules.ts): online (không COD), SUCCESS; thứ tự
// "đến trước" là (paid_at, id) với paid_at NULL xếp cuối; PAID_AFTER_EXPIRY = nhóm CÓ đơn và mọi đơn CANCELLED.
// So sánh id theo COLLATE "C" cho trùng với so sánh chuỗi của JS. Thêm điều kiện "chưa có dòng hoàn nào" (kể cả
// FAILED — xử lý trên chính dòng đó). Danh sách được phân loại lại bằng classifyAbnormalPayment sau khi đọc, nên
// nếu hai bên lệch nhau thì chỉ có thể làm mất một dòng khỏi danh sách chứ không cho hoàn sai (refundPayment
// còn kiểm lại dưới khoá).
const ABNORMAL_PAYMENT_FILTER = Prisma.sql`
  p.status = 'SUCCESS'::"PaymentStatus"
  AND p.method <> 'COD'::"PaymentMethod"
  AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.payment_id = p.id)
  AND (
    EXISTS (
      SELECT 1 FROM payments e
      WHERE e.checkout_group_id = p.checkout_group_id
        AND e.id <> p.id
        AND e.status = 'SUCCESS'::"PaymentStatus"
        AND e.method <> 'COD'::"PaymentMethod"
        AND (COALESCE(e.paid_at, 'infinity'::timestamp), e.id COLLATE "C")
          < (COALESCE(p.paid_at, 'infinity'::timestamp), p.id COLLATE "C")
    )
    OR (
      EXISTS (SELECT 1 FROM orders o WHERE o.checkout_group_id = p.checkout_group_id)
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.checkout_group_id = p.checkout_group_id
          AND o.status <> 'CANCELLED'::"OrderStatus"
      )
    )
  )`;

const toAdminRequest = (request: LoadedAdminRequest): AdminRefundRequest => {
  const latest = request.order.checkoutGroup.payments[0] ?? null;
  return {
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
    ...getAdminRefundRequestActions({
      kind: request.kind,
      status: request.status,
    }),
    shop: request.shop,
    buyer: request.user,
    order: {
      id: request.order.id,
      status: request.order.status,
      totalAmount: money(request.order.totalAmount),
      recipientName: request.order.recipientName,
      items: request.order.items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        sku: item.sku,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        priceAtPurchase: money(item.priceAtPurchase),
      })),
      itemCount: request.order._count.items,
      paymentMethod: latest?.method ?? null,
      paymentStatus: latest?.status ?? null,
      refund: request.order.paymentRefund
        ? {
            status: request.order.paymentRefund.status,
            amount: money(request.order.paymentRefund.amount),
          }
        : null,
    },
  };
};

const toAdminRefund = (refund: LoadedAdminRefund, now: Date): AdminRefund => ({
  id: refund.id,
  status: refund.status,
  amount: money(refund.amount),
  attempts: refund.attempts,
  reason: refund.reason,
  failureReason: refund.failureReason,
  gatewayRef: refund.gatewayRef,
  initiatedByType: refund.initiatedByType,
  createdAt: refund.createdAt.toISOString(),
  updatedAt: refund.updatedAt.toISOString(),
  completedAt: refund.completedAt?.toISOString() ?? null,
  ...getAdminRefundActions({
    status: refund.status,
    updatedAt: refund.updatedAt,
    now,
  }),
  payment: {
    id: refund.payment.id,
    method: refund.payment.method,
    status: refund.payment.status,
    amount: money(refund.payment.amount),
    refundedAmount: money(refund.payment.refundedAmount),
    txnRef: refund.payment.txnRef,
    transactionId: refund.payment.transactionId,
  },
  order: refund.order
    ? {
        id: refund.order.id,
        status: refund.order.status,
        totalAmount: money(refund.order.totalAmount),
        recipientName: refund.order.recipientName,
      }
    : null,
  buyer: refund.payment.checkoutGroup.user,
});

// Phần ĐỌC của khu Admin xử lý tiền hoàn (Week9.md 2.9). Ghi/chuyển trạng thái nằm ở RefundRequestActionService
// và RefundService; module admin chỉ gọi các service này qua OrderModule (không import file nội bộ).
@Injectable()
export class RefundQueryService {
  private readonly logger = new Logger(RefundQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET /admin/refund-requests. Hàng chờ (đang chờ seller / đã lên sàn) xếp CŨ NHẤT TRƯỚC theo lúc vào trạng
  // đó (statusChangedAt: lúc chuyển lên sàn, không phải lúc người mua gửi) để không ai bị bỏ quên; các trạng
  // thái đã xong xếp mới nhất trước. `id` làm tie-break để phân trang ổn định.
  async listRefundRequests(
    query: AdminRefundRequestListQuery,
  ): Promise<AdminRefundRequestListResponse> {
    const isQueue =
      query.status === 'PENDING_SELLER' || query.status === 'ESCALATED';
    const direction = isQueue ? 'asc' : 'desc';
    const where: Prisma.RefundRequestWhereInput = { status: query.status };

    const [total, requests] = await Promise.all([
      this.prisma.refundRequest.count({ where }),
      this.prisma.refundRequest.findMany({
        where,
        select: adminRequestSelect,
        orderBy: [{ statusChangedAt: direction }, { id: direction }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items: requests.map(toAdminRequest),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Một yêu cầu (sau khi Admin quyết định, để trả lại dòng mới nhất). Không có thì 404.
  async getRefundRequest(requestId: string): Promise<AdminRefundRequest> {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id: requestId },
      select: adminRequestSelect,
    });
    if (!request) {
      throw new AppException(
        404,
        'REFUND_REQUEST_NOT_FOUND',
        'Refund request not found',
      );
    }
    return toAdminRequest(request);
  }

  // GET /admin/refunds. NEEDS_ACTION = FAILED + PENDING bỏ dở (`updatedAt <=` ngưỡng, khớp biên `>=` của
  // getAdminRefundActions/RefundService) — đúng tập thử lại/ghi nhận thủ công được. Hàng chờ xếp cũ nhất trước,
  // lịch sử đã hoàn (SUCCEEDED) mới nhất trước. Khớp index [status, updatedAt].
  async listRefunds(
    query: AdminRefundListQuery,
  ): Promise<AdminRefundListResponse> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - REFUND_PENDING_STALE_MS);
    const where: Prisma.PaymentRefundWhereInput =
      query.status === 'NEEDS_ACTION'
        ? {
            OR: [
              { status: 'FAILED' },
              { status: 'PENDING', updatedAt: { lte: staleCutoff } },
            ],
          }
        : { status: query.status };
    const direction = query.status === 'SUCCEEDED' ? 'desc' : 'asc';

    const [total, refunds] = await Promise.all([
      this.prisma.paymentRefund.count({ where }),
      this.prisma.paymentRefund.findMany({
        where,
        select: adminRefundSelect,
        orderBy: [{ updatedAt: direction }, { id: direction }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items: refunds.map((refund) => toAdminRefund(refund, now)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Một khoản hoàn (sau retry / ghi nhận thủ công / hoàn thanh toán bất thường). Không có thì 404.
  async getRefund(refundId: string): Promise<AdminRefund> {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: adminRefundSelect,
    });
    if (!refund) {
      throw new AppException(
        404,
        'PAYMENT_REFUND_NOT_FOUND',
        'Refund not found',
      );
    }
    return toAdminRefund(refund, new Date());
  }

  // GET /admin/refundable-payments — thanh toán bất thường chưa có dòng hoàn nào (PAID_AFTER_EXPIRY, thanh toán
  // trùng), cũ nhất trước. Lọc bằng SQL thô (ABNORMAL_PAYMENT_FILTER), đọc chi tiết bằng Prisma rồi phân loại
  // lại bằng classifyAbnormalPayment để cùng một luật với lúc hoàn thật.
  async listRefundablePayments(
    query: AdminRefundablePaymentListQuery,
  ): Promise<AdminRefundablePaymentListResponse> {
    const offset = (query.page - 1) * query.limit;
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM payments p
        WHERE ${ABNORMAL_PAYMENT_FILTER}
        ORDER BY p.paid_at ASC NULLS LAST, p.id ASC
        LIMIT ${query.limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM payments p
        WHERE ${ABNORMAL_PAYMENT_FILTER}`,
    ]);

    const ids = rows.map((row) => row.id);
    const loaded = ids.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: ids } },
          select: refundablePaymentSelect,
        })
      : [];
    const byId = new Map(loaded.map((payment) => [payment.id, payment]));

    const items: AdminRefundablePayment[] = [];
    for (const id of ids) {
      const payment = byId.get(id);
      const item = payment ? this.toRefundablePayment(payment) : null;
      if (item) items.push(item);
      else
        this.logger.warn(
          `Payment ${id} matched the abnormal-payment filter but is not classified as abnormal — skipped`,
        );
    }

    return {
      items,
      total: Number(counts[0]?.count ?? 0),
      page: query.page,
      limit: query.limit,
    };
  }

  private toRefundablePayment(
    payment: LoadedRefundablePayment,
  ): AdminRefundablePayment | null {
    const kind = classifyAbnormalPayment({
      paymentId: payment.id,
      groupPayments: payment.checkoutGroup.payments,
      orderStatuses: payment.checkoutGroup.orders.map((order) => order.status),
    });
    if (!kind) return null;
    return {
      id: payment.id,
      kind,
      method: payment.method,
      amount: money(payment.amount),
      paidAt: payment.paidAt?.toISOString() ?? null,
      txnRef: payment.txnRef,
      transactionId: payment.transactionId,
      checkoutGroupId: payment.checkoutGroupId,
      buyer: payment.checkoutGroup.user,
      orders: payment.checkoutGroup.orders.map((order) => ({
        id: order.id,
        status: order.status,
        totalAmount: money(order.totalAmount),
      })),
    };
  }
}
