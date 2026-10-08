import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus, RefundRequestKind } from '@prisma/client';
import {
  isRefundReasonAllowedForKind,
  type CreateRefundRequestInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { isWithinEscalateWindow, isWithinRefundWindow } from './order-actions';
import type { OrderActor } from './order-status.service';
import {
  readRefundEscalateDays,
  readRefundSellerResponseHours,
  readRefundWindowDays,
} from './refund-config';
import { RefundRequestService } from './refund-request.service';

type NotAllowedReason =
  | 'NOT_ELIGIBLE_STATUS'
  | 'WINDOW_EXPIRED'
  | 'ALREADY_REQUESTED'
  | 'PAYMENT_NOT_COLLECTED';

const HOUR_MS = 60 * 60 * 1000;

const orderNotFound = () =>
  new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');

const requestNotFound = () =>
  new AppException(404, 'REFUND_REQUEST_NOT_FOUND', 'Refund request not found');

const requestNotAllowed = (reason: NotAllowedReason) =>
  new AppException(
    409,
    'REFUND_REQUEST_NOT_ALLOWED',
    `Refund request is not allowed: ${reason}`,
    { reason },
  );

// Loại yêu cầu do BE SUY RA từ trạng thái đơn, không nhận từ client (Week9.md 1.3): shop đã xác nhận/đóng
// gói ⇒ xin HỦY; đã nhận hàng ⇒ xin TRẢ HÀNG/hoàn tiền. Trạng thái khác không có yêu cầu: chờ xác nhận thì
// hủy ngay, đang giao thì không hủy được, đã hủy/hoàn thì không còn gì để xin.
function requestKindFor(status: OrderStatus): RefundRequestKind | null {
  if (status === 'CONFIRMED' || status === 'PACKED') return 'CANCEL';
  if (status === 'COMPLETED') return 'RETURN';
  return null;
}

// Các hành động của NGƯỜI MUA lên yêu cầu hủy/trả hàng: gửi, rút, khiếu nại lên sàn (Week9.md 2.6). Chỉ kiểm
// quyền sở hữu + điều kiện nghiệp vụ rồi để RefundRequestService.transition (điểm ghi duy nhất, kiểm bảng chuyển
// có actor) đổi trạng thái. Yêu cầu của người khác / không tồn tại cùng trả 404 (không lộ id nào có thật).
// Việc DUYỆT / TỪ CHỐI của seller và Admin (2.7/2.9) đi qua RefundService vì duyệt kéo theo hủy đơn + hoàn tiền.
@Injectable()
export class RefundRequestActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundRequestService: RefundRequestService,
  ) {}

  // Gửi yêu cầu cho đơn của mình. Loại yêu cầu suy từ trạng thái đơn; điều kiện (cửa sổ trả hàng, đã gửi rồi,
  // thanh toán đã thu) kiểm ở đây — cờ canRequestCancel/canRequestReturn ở order-actions.ts là cùng luật nhưng
  // chỉ để FE ẩn/hiện nút, BE vẫn tự kiểm lại.
  async createForBuyer(
    userId: string,
    orderId: string,
    input: CreateRefundRequestInput,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        shopId: true,
        status: true,
        checkoutGroup: {
          select: { payments: { select: { method: true, status: true } } },
        },
        statusHistory: {
          where: { toStatus: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        refundRequests: {
          where: { status: { not: 'WITHDRAWN' } },
          select: { kind: true },
        },
      },
    });
    if (!order) throw orderNotFound();

    const kind = requestKindFor(order.status);
    if (!kind) throw requestNotAllowed('NOT_ELIGIBLE_STATUS');
    // Lý do chỉ hợp lệ trong tập của đúng loại yêu cầu (vd "hàng lỗi" không dùng để xin hủy trước giao). Kiểm
    // sau khi biết loại; báo lỗi theo field như mọi lỗi validate khác.
    if (!isRefundReasonAllowedForKind(kind, input.reasonCode)) {
      throw new BadRequestException(
        'reasonCode: order.validationRefundReasonInvalid',
      );
    }

    const now = new Date();
    if (kind === 'RETURN') {
      const completedAt = order.statusHistory[0]?.createdAt;
      if (
        !completedAt ||
        !isWithinRefundWindow(completedAt, now, readRefundWindowDays())
      ) {
        throw requestNotAllowed('WINDOW_EXPIRED');
      }
    }
    if (order.refundRequests.some((request) => request.kind === kind)) {
      throw requestNotAllowed('ALREADY_REQUESTED');
    }
    // Đơn COD chưa thu tiền vẫn xin hủy được (không có tiền để hoàn); đơn online phải có thanh toán thành công.
    const payments = order.checkoutGroup.payments;
    const isCod = payments.some((payment) => payment.method === 'COD');
    if (!isCod && !payments.some((payment) => payment.status === 'SUCCESS')) {
      throw requestNotAllowed('PAYMENT_NOT_COLLECTED');
    }

    const actor: OrderActor = { type: 'BUYER', id: userId };
    try {
      await this.prisma.$transaction(async (tx) => {
        // Khoá hàng đơn để tuần tự hoá với seller đóng gói/giao/hủy: nếu đơn đã chuyển sang trạng thái khác
        // giữa lúc đọc và lúc này thì dừng, không để lại yêu cầu mồ côi cho một đơn không còn hợp lệ.
        const locked = await tx.$queryRaw<{ status: OrderStatus }[]>`
          SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
        if (locked[0]?.status !== order.status) {
          throw new AppException(
            409,
            'ORDER_ALREADY_CHANGED',
            'Order status was changed by another request',
          );
        }

        const request = await tx.refundRequest.create({
          data: {
            orderId,
            shopId: order.shopId,
            userId,
            kind,
            reasonCode: input.reasonCode,
            reasonNote: input.reasonNote ?? null,
            sellerRespondBy: new Date(
              now.getTime() + readRefundSellerResponseHours() * HOUR_MS,
            ),
          },
          select: { id: true, createdAt: true },
        });
        await this.refundRequestService.recordCreated(tx, request, actor);
      });
    } catch (error) {
      // Index duy nhất từng phần (order_id, kind) WHERE status <> 'WITHDRAWN' là trọng tài cuối khi hai lần gửi
      // lọt qua bước kiểm ở trên cùng lúc. Lỗi P2002 làm hỏng cả transaction nên bắt ở NGOÀI $transaction.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw requestNotAllowed('ALREADY_REQUESTED');
      }
      throw error;
    }
  }

  // Rút yêu cầu khi seller CHƯA trả lời. Trả orderId để controller đọc lại chi tiết đơn.
  async withdrawForBuyer(
    userId: string,
    requestId: string,
  ): Promise<{ orderId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.findOwned(tx, userId, requestId);
      await this.refundRequestService.transition(
        tx,
        requestId,
        request.status,
        'WITHDRAWN',
        { type: 'BUYER', id: userId },
      );
      return { orderId: request.orderId };
    });
  }

  // Khiếu nại lên sàn sau khi seller TỪ CHỐI, trong REFUND_ESCALATE_DAYS kể từ lúc bị từ chối (một lần duy nhất:
  // sau đó yêu cầu ở ESCALATED, người mua không còn cạnh nào). Trạng thái khác REJECTED_BY_SELLER bị bảng chuyển
  // từ chối (409 REFUND_REQUEST_INVALID_TRANSITION).
  async escalateForBuyer(
    userId: string,
    requestId: string,
  ): Promise<{ orderId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.findOwned(tx, userId, requestId);
      if (
        request.status === 'REJECTED_BY_SELLER' &&
        !isWithinEscalateWindow(
          request.statusChangedAt,
          new Date(),
          readRefundEscalateDays(),
        )
      ) {
        throw requestNotAllowed('WINDOW_EXPIRED');
      }
      await this.refundRequestService.transition(
        tx,
        requestId,
        request.status,
        'ESCALATED',
        { type: 'BUYER', id: userId },
      );
      return { orderId: request.orderId };
    });
  }

  private async findOwned(
    tx: Prisma.TransactionClient,
    userId: string,
    requestId: string,
  ) {
    const request = await tx.refundRequest.findFirst({
      where: { id: requestId, userId },
      select: { orderId: true, status: true, statusChangedAt: true },
    });
    if (!request) throw requestNotFound();
    return request;
  }
}
