import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus, RefundRequestKind } from '@prisma/client';
import {
  canActorTransitionRefundRequest,
  isRefundReasonAllowedForKind,
  type CreateRefundRequestInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  getSellerRefundRequestActions,
  isWithinEscalateWindow,
  isWithinRefundWindow,
} from './order-actions';
import type { OrderActor } from './order-status.service';
import {
  readRefundEscalateDays,
  readRefundSellerResponseHours,
  readRefundWindowDays,
} from './refund-config';
import { RefundRequestService } from './refund-request.service';
import { RefundService } from './refund.service';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

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

// Các hành động lên yêu cầu hủy/trả hàng: của NGƯỜI MUA (gửi, rút, khiếu nại lên sàn — Week9.md 2.6) và của
// SELLER (duyệt, từ chối — 2.7). Chỉ kiểm quyền sở hữu + điều kiện nghiệp vụ rồi để RefundRequestService.transition
// (điểm ghi duy nhất, kiểm bảng chuyển có actor) đổi trạng thái. Yêu cầu của người khác / không tồn tại cùng
// trả 404 (không lộ id nào có thật). DUYỆT kéo theo hủy/hoàn đơn nên đi qua RefundService (cùng transaction với
// việc đóng yêu cầu); Admin quyết định ở 2.9 cũng qua RefundService.
@Injectable()
export class RefundRequestActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundRequestService: RefundRequestService,
    private readonly refundService: RefundService,
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

  // --- Seller (Week9.md 2.7) --------------------------------------------------------------------

  // Seller DUYỆT yêu cầu: yêu cầu HỦY ⇒ hủy đơn (kho + voucher + hoàn tiền nếu đã thu), yêu cầu TRẢ HÀNG ⇒ đơn
  // COMPLETED → REFUNDED (không cộng kho, không trả voucher). Cả hai đóng đúng yêu cầu này cùng transaction qua
  // `refundRequestId` (fail-closed: người mua vừa rút ⇒ 409, đơn không bị hủy oan). Cho phép cả yêu cầu HỦY đã
  // lên sàn (ESCALATED): seller nhượng bộ. Ghi chú tuỳ chọn, người mua đọc được.
  async approveForSeller(
    shopId: string,
    sellerUserId: string,
    requestId: string,
    note?: string | null,
  ): Promise<void> {
    const request = await this.findSellerRequest(
      this.prisma,
      shopId,
      requestId,
    );
    // Kiểm sớm theo bảng chuyển có actor để báo đúng lỗi, thay vì để RefundService lật đơn rồi mới rollback.
    if (!getSellerRefundRequestActions(request).canApprove) {
      throw this.invalidTransition(request.status, 'APPROVED');
    }

    const actor: OrderActor = { type: 'SELLER', id: sellerUserId };
    if (request.kind === 'CANCEL') {
      await this.refundService.cancelOrderWithRefund(actor, request.orderId, {
        reason: note,
        refundRequestId: request.id,
        onlyFrom: ['CONFIRMED', 'PACKED'],
      });
    } else {
      await this.refundService.refundReturnedOrder(actor, request.orderId, {
        reason: note,
        refundRequestId: request.id,
      });
    }
  }

  // Seller TỪ CHỐI yêu cầu (chỉ khi đang chờ seller) — ghi chú BẮT BUỘC, ghi vào RefundRequestHistory.note để
  // người mua đọc. Đơn giữ nguyên trạng thái; người mua có thể khiếu nại lên sàn trong REFUND_ESCALATE_DAYS.
  async rejectForSeller(
    shopId: string,
    sellerUserId: string,
    requestId: string,
    note: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await this.findSellerRequest(tx, shopId, requestId);
      await this.refundRequestService.transition(
        tx,
        request.id,
        request.status,
        'REJECTED_BY_SELLER',
        { type: 'SELLER', id: sellerUserId },
        note,
      );
    });
  }

  // --- Admin (Week9.md 2.9) -------------------------------------------------------------------------

  // Admin quyết định MỘT yêu cầu, cả khi đã lên sàn (khiếu nại) lẫn khi còn chờ seller (thay seller vắng mặt).
  // Không có phạm vi shop: Admin thấy mọi yêu cầu (kể cả đã rút — khi đó bảng chuyển từ chối bằng 409).
  //  - APPROVE: giống seller duyệt — yêu cầu HỦY ⇒ hủy đơn (kho, voucher, hoàn tiền nếu đã thu), yêu cầu TRẢ HÀNG ⇒
  //    COMPLETED → REFUNDED (không cộng kho). Đóng ĐÚNG yêu cầu này cùng transaction (`refundRequestId`, fail-closed:
  //    người mua vừa rút hoặc seller vừa quyết thì cả giao dịch rollback, đơn không bị hủy oan).
  //  - REJECT: đơn giữ nguyên; ghi chú BẮT BUỘC (người mua và seller đọc được lý do), schema đã kiểm.
  // Kiểm sớm theo bảng chuyển có actor ADMIN để báo 409 đúng ngay từ đầu thay vì lật đơn rồi mới rollback.
  async decideForAdmin(
    adminId: string,
    requestId: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string | null,
  ): Promise<void> {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id: requestId },
      select: { id: true, kind: true, status: true, orderId: true },
    });
    if (!request) throw requestNotFound();

    const to = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (
      !canActorTransitionRefundRequest(
        'ADMIN',
        request.kind,
        request.status,
        to,
      )
    ) {
      throw this.invalidTransition(request.status, to);
    }

    const actor: OrderActor = { type: 'ADMIN', id: adminId };
    if (decision === 'REJECT') {
      await this.prisma.$transaction((tx) =>
        this.refundRequestService.transition(
          tx,
          request.id,
          request.status,
          'REJECTED',
          actor,
          note,
        ),
      );
      return;
    }

    if (request.kind === 'CANCEL') {
      await this.refundService.cancelOrderWithRefund(actor, request.orderId, {
        reason: note,
        refundRequestId: request.id,
        onlyFrom: ['CONFIRMED', 'PACKED'],
      });
    } else {
      await this.refundService.refundReturnedOrder(actor, request.orderId, {
        reason: note,
        refundRequestId: request.id,
      });
    }
  }

  // --- Hệ thống (RefundJob, Week9.md 2.8) -----------------------------------------------------------

  // Xử lý MỘT yêu cầu mà seller đã im lặng quá `sellerRespondBy` (actor SYSTEM, Week9.md 1.3/1.5):
  //  - yêu cầu HỦY ⇒ tự duyệt (hủy đơn + kho + voucher + hoàn tiền nếu đã thu, cùng đường với seller bấm duyệt) —
  //    người mua xin hủy trước giao, để seller im lặng giữ đơn mãi là bất lợi cho người mua;
  //  - yêu cầu TRẢ HÀNG ⇒ chuyển Admin (ESCALATED), KHÔNG tự duyệt — hàng có thể chưa trả về shop.
  // Trả kết quả đã làm; null = không cần làm gì (đã có người xử lý trước / chưa quá hạn / thua race với seller,
  // buyer hoặc Admin) — là chuyện bình thường của job chạy song song, không phải lỗi. Lỗi thật (vd lỗi DB, đơn ở
  // trạng thái không hủy được) vẫn ném cho job log.
  async resolveOverdueRequest(
    requestId: string,
    now: Date = new Date(),
  ): Promise<'APPROVED' | 'ESCALATED' | null> {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        kind: true,
        status: true,
        orderId: true,
        sellerRespondBy: true,
      },
    });
    if (
      !request ||
      request.status !== 'PENDING_SELLER' ||
      request.sellerRespondBy.getTime() >= now.getTime()
    ) {
      return null;
    }

    const actor: OrderActor = { type: 'SYSTEM' };
    try {
      if (request.kind === 'CANCEL') {
        // `refundRequestId` ⇒ fail-closed: người mua vừa rút / seller vừa quyết thì cả giao dịch rollback, đơn
        // không bị hủy oan. `onlyFrom` khớp luật yêu cầu hủy: chỉ đơn shop ĐÃ xác nhận mới có yêu cầu hủy.
        await this.refundService.cancelOrderWithRefund(actor, request.orderId, {
          refundRequestId: request.id,
          onlyFrom: ['CONFIRMED', 'PACKED'],
        });
        return 'APPROVED';
      }
      await this.prisma.$transaction((tx) =>
        this.refundRequestService.transition(
          tx,
          request.id,
          'PENDING_SELLER',
          'ESCALATED',
          actor,
        ),
      );
      return 'ESCALATED';
    } catch (error) {
      if (this.isLostRace(error)) return null;
      throw error;
    }
  }

  // Thua race với người khác xử lý cùng yêu cầu/đơn: yêu cầu không còn ở PENDING_SELLER (seller duyệt/từ chối,
  // người mua rút) hoặc đơn vừa đổi trạng thái giữa lúc kiểm và lúc khoá (seller tự hủy đồng thời).
  private isLostRace(error: unknown): boolean {
    return (
      error instanceof AppException &&
      (error.code === 'REFUND_REQUEST_INVALID_TRANSITION' ||
        error.code === 'ORDER_ALREADY_CHANGED')
    );
  }

  // Seller chỉ thấy yêu cầu của shop mình VÀ của đơn Seller được thấy (cùng predicate sellerVisibleOrderFilter như
  // mọi truy vấn đơn của Seller); yêu cầu đã rút coi như không tồn tại.
  private async findSellerRequest(
    client: Pick<Prisma.TransactionClient, 'refundRequest'>,
    shopId: string,
    requestId: string,
  ) {
    const request = await client.refundRequest.findFirst({
      where: {
        id: requestId,
        shopId,
        status: { not: 'WITHDRAWN' },
        order: sellerVisibleOrderFilter(),
      },
      select: { id: true, kind: true, status: true, orderId: true },
    });
    if (!request) throw requestNotFound();
    return request;
  }

  private invalidTransition(from: string, to: string): AppException {
    return new AppException(
      409,
      'REFUND_REQUEST_INVALID_TRANSITION',
      `Cannot change refund request status from ${from} to ${to}`,
    );
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
