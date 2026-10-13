import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { blocksSellerFulfilment, type ShipOrderInput } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { lockGroupOrders, settleCodPayment } from './checkout-group-tx';
import { getCancelBlockReason } from './order-actions';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService, type OrderActor } from './order-status.service';
import { PaymentService } from './payment.service';
import { RefundService } from './refund.service';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

// Đơn cần cho 1 hành động: định danh + đủ dữ kiện để kiểm luật. Đọc 1 lần ở đầu mỗi transaction (không
// khoá) — câu UPDATE có điều kiện của OrderStatusService mới là trọng tài.
const actionOrderSelect = {
  id: true,
  status: true,
  checkoutGroupId: true,
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

type LoadedOrder = Prisma.OrderGetPayload<{
  select: typeof actionOrderSelect;
}> & { paymentMethod: PaymentMethod | null };

// Phạm vi truy cập: buyer chỉ đơn của mình (userId), seller chỉ đơn của shop mình (shopId, đã được
// ShopOwnerGuard xác nhận) VÀ ở trạng thái Seller được thấy. Không bao giờ tin id đơn suông.
type OrderScope = Prisma.OrderWhereInput & { id: string };

// Seller thao tác đơn: đơn chưa thanh toán (và đơn chưa từng được thanh toán rồi bị hủy) TUYỆT ĐỐI không
// đụng được và cũng không lộ là có tồn tại (404 y hệt đơn không có thật, không phải 409) — cùng điều
// kiện với danh sách/chi tiết (sellerVisibleOrderFilter, Week7.md 1.13).
const sellerScope = (shopId: string, orderId: string): OrderScope => ({
  ...sellerVisibleOrderFilter(),
  id: orderId,
  shopId,
});

interface ChangeStatusOptions {
  note?: string;
  // Chạy TRƯỚC kiểm "đang đúng trạng thái" — để báo lý do cụ thể hơn ORDER_INVALID_TRANSITION.
  precheck?: (order: LoadedOrder) => void;
  // Chạy SAU khi chuyển trạng thái thành công, trong CÙNG transaction (ghi vận chuyển, kiểm yêu cầu hủy...);
  // ném lỗi ở đây ⇒ rollback cả việc chuyển trạng thái.
  after?: (tx: TxClient, order: LoadedOrder) => Promise<void>;
}

const orderNotFound = () =>
  new AppException(404, 'ORDER_NOT_FOUND', 'Order not found');

// Các hành động đổi trạng thái đơn của buyer và seller (Week8.md 2.6). Mỗi hành động = 1
// $transaction: đọc đơn theo phạm vi → kiểm luật → OrderStatusService.transition (UPDATE có điều
// kiện, ghi history) → tác dụng phụ (hoàn kho, thu tiền COD). Thứ tự khoá chung: đơn → variant →
// voucher (note-inventory-payment-expiry_week7.md mục 20).
//
// 2 loại lỗi 409 khác nhau có chủ đích: ORDER_INVALID_TRANSITION = lúc đọc đơn đã không ở trạng thái
// cho phép; ORDER_ALREADY_CHANGED = lúc đọc còn đúng nhưng ĐÃ có người khác đổi trước khi cập nhật
// (thua race) — người dùng cần tải lại trang.
@Injectable()
export class OrderActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService,
    private readonly paymentService: PaymentService,
    private readonly orderEmailService: OrderEmailService,
    private readonly refundService: RefundService,
  ) {}

  // --- Seller ---------------------------------------------------------------------------------

  // Mọi hành động có email báo buyer gọi notify* SAU KHI transaction đã commit (changeStatus trả về).
  // notify* không bao giờ ném — mail lỗi không làm fail hành động đã thành công (Week8.md 2.8).
  async confirm(
    shopId: string,
    sellerUserId: string,
    orderId: string,
  ): Promise<void> {
    await this.changeStatus(
      sellerScope(shopId, orderId),
      'PENDING',
      'CONFIRMED',
      { type: 'SELLER', id: sellerUserId },
    );
    await this.orderEmailService.notifyConfirmed(orderId);
  }

  // Đóng gói / giao hàng bị chặn (409 REFUND_REQUEST_PENDING) khi người mua đang có yêu cầu HỦY chờ xử lý:
  // seller phải phản hồi yêu cầu trước (Week9.md 1.3). Kiểm TRONG transaction, SAU khi đã khoá hàng đơn bằng
  // câu UPDATE chuyển trạng thái — người mua gửi yêu cầu cũng khoá hàng đơn (FOR UPDATE) nên hai bên xếp hàng:
  // yêu cầu commit trước thì ở đây thấy và rollback; chuyển trạng thái commit trước thì người mua thấy đơn đã
  // đổi (ORDER_ALREADY_CHANGED) và không để lại yêu cầu cho đơn đã đóng gói/giao.
  pack(shopId: string, sellerUserId: string, orderId: string): Promise<void> {
    return this.changeStatus(
      sellerScope(shopId, orderId),
      'CONFIRMED',
      'PACKED',
      { type: 'SELLER', id: sellerUserId },
      { after: (tx, order) => this.assertNoPendingCancelRequest(tx, order.id) },
    );
  }

  // Mã vận đơn nhập tay, tuỳ chọn (Week8.md 1.10) — ghi cùng transaction với việc chuyển trạng thái.
  async ship(
    shopId: string,
    sellerUserId: string,
    orderId: string,
    input: ShipOrderInput,
  ): Promise<void> {
    await this.changeStatus(
      sellerScope(shopId, orderId),
      'PACKED',
      'SHIPPING',
      { type: 'SELLER', id: sellerUserId },
      {
        after: async (tx, order) => {
          await this.assertNoPendingCancelRequest(tx, order.id);
          await tx.order.update({
            where: { id: order.id },
            data: {
              carrier: input.carrier ?? null,
              trackingCode: input.trackingCode ?? null,
            },
          });
        },
      },
    );
    await this.orderEmailService.notifyShipped(orderId);
  }

  // Từ chối đơn đang chờ xác nhận (PENDING → CANCELLED), mọi phương thức thanh toán (Week9.md 1.3): đơn COD
  // chỉ hoàn kho + trả voucher, đơn đã trả online còn hoàn tiền tự động. Uỷ quyền cho RefundService (cũng tự
  // gửi email báo buyer). `onlyFrom: ['PENDING']`: nếu buyer/seller khác vừa đổi trạng thái thì thua race,
  // không hủy đè lên đơn đã xác nhận.
  async reject(
    shopId: string,
    sellerUserId: string,
    orderId: string,
    reason: string,
  ): Promise<void> {
    const order = await this.findSellerOrderHead(shopId, orderId);
    if (order.status !== 'PENDING') throw this.cancelRefused(order.status);

    await this.refundService.cancelOrderWithRefund(
      { type: 'SELLER', id: sellerUserId },
      orderId,
      { reason, onlyFrom: ['PENDING'] },
    );
  }

  // Seller tự hủy đơn đã xác nhận/đóng gói (CONFIRMED/PACKED → CANCELLED), lý do bắt buộc, kèm hoàn tiền nếu đã
  // thu và tự đóng yêu cầu hủy đang mở của người mua (nếu có — hủy chính là cách trả lời). Đơn chờ xác nhận dùng
  // `reject`; đơn đã giao cho vận chuyển không hủy được.
  async cancelBySeller(
    shopId: string,
    sellerUserId: string,
    orderId: string,
    reason: string,
  ): Promise<void> {
    const order = await this.findSellerOrderHead(shopId, orderId);
    if (order.status !== 'CONFIRMED' && order.status !== 'PACKED') {
      throw this.cancelRefused(order.status);
    }

    await this.refundService.cancelOrderWithRefund(
      { type: 'SELLER', id: sellerUserId },
      orderId,
      { reason, onlyFrom: ['CONFIRMED', 'PACKED'] },
    );
  }

  // --- Buyer ----------------------------------------------------------------------------------

  // Hủy NGAY đơn của mình (Week9.md 1.3). Đơn chưa thanh toán ⇒ hủy cả NHÓM thanh toán (1 Payment cho cả
  // nhóm). Đơn đang chờ shop xác nhận (PENDING) ⇒ uỷ quyền cho RefundService: đơn COD chỉ đổi trạng thái + kho
  // + voucher, đơn đã trả online còn hoàn tiền tự động về nguồn thanh toán; RefundService cũng tự gửi email.
  // Từ CONFIRMED trở đi không hủy ngay được: 409 ORDER_CANCEL_NOT_ALLOWED (người mua gửi YÊU CẦU hủy ở
  // POST /orders/:id/refund-requests thay vì gọi route này).
  async cancelByBuyer(
    userId: string,
    orderId: string,
    reason?: string,
  ): Promise<void> {
    const head = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true, checkoutGroupId: true },
    });
    if (!head) throw orderNotFound();

    if (head.status === 'AWAITING_PAYMENT') {
      await this.paymentService.cancelCheckoutGroup(
        userId,
        head.checkoutGroupId,
        reason,
      );
      return;
    }

    if (head.status === 'PENDING') {
      // Chỉ lý do do chính buyer nhập; không có thì để trống (null) — KHÔNG ghi chuỗi mặc định, vì `note` của
      // buyer được hiển thị nguyên văn cho shop và cho chính buyer.
      await this.refundService.cancelOrderWithRefund(
        { type: 'BUYER', id: userId },
        orderId,
        // Hủy NGAY chỉ khi shop chưa xác nhận: nếu shop vừa xác nhận giữa lúc kiểm và lúc hủy thì thua race
        // (409 ORDER_ALREADY_CHANGED), người mua phải gửi yêu cầu hủy thay vì hủy đè lên shop.
        { reason, onlyFrom: ['PENDING'] },
      );
      return;
    }

    throw this.cancelRefused(head.status);
  }

  // Buyer xác nhận đã nhận hàng: SHIPPING → COMPLETED. Với COD, đây là lúc thu tiền: khi mọi đơn
  // không bị hủy của nhóm đã COMPLETED ⇒ Payment COD → SUCCESS (Week8.md 1.6). Điều kiện được kiểm lại
  // cả khi một đơn COD của nhóm bị hủy/từ chối (RefundService.cancelOrderWithRefund) vì đó có thể là đơn cuối cùng.
  async confirmReceived(userId: string, orderId: string): Promise<void> {
    await this.completeShipped(
      { id: orderId, userId },
      { type: 'BUYER', id: userId },
      'Received by buyer',
    );
  }

  // --- Hệ thống -------------------------------------------------------------------------------

  // Tự hoàn tất đơn đã giao mà buyer không bấm "Đã nhận hàng" sau N ngày (Week8.md 1.7) — gọi bởi
  // OrderAutoCompleteJob. Dùng CHUNG đường hoàn tất với buyer bấm tay nên COD cũng được thu tiền đúng
  // cách. Trả true nếu đã hoàn tất; false nếu đơn đã được xử lý ở nơi khác trước khi job tới (buyer vừa
  // bấm tay, đơn không còn SHIPPING...) — là chuyện bình thường, không phải lỗi. Lỗi thật (DB...) ném lên
  // để job log và đi tiếp đơn khác.
  async autoCompleteShipped(orderId: string, days: number): Promise<boolean> {
    try {
      await this.completeShipped(
        { id: orderId },
        { type: 'SYSTEM' },
        `Auto-completed: not confirmed by buyer within ${days} day(s) of shipping`,
      );
      return true;
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.code === 'ORDER_INVALID_TRANSITION' ||
          error.code === 'ORDER_ALREADY_CHANGED' ||
          error.code === 'ORDER_NOT_FOUND')
      ) {
        return false;
      }
      throw error;
    }
  }

  // SHIPPING → COMPLETED cho cả buyer lẫn hệ thống (khác nhau ở phạm vi đọc đơn, actor và ghi chú). Với
  // COD khoá TOÀN BỘ đơn của nhóm theo id tăng dần TRƯỚC khi chuyển: 2 đơn cùng nhóm hoàn tất đồng thời
  // sẽ xếp hàng ở đây, nên đơn thứ hai thấy đơn thứ nhất đã COMPLETED và chốt thu tiền — không bên nào
  // bỏ sót vì "chưa thấy" thay đổi chưa commit của bên kia.
  private async completeShipped(
    scope: OrderScope,
    actor: OrderActor,
    note: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, scope);
      if (order.status !== 'SHIPPING') throw this.invalidTransition(order);

      const isCod = order.paymentMethod === 'COD';
      if (isCod) await lockGroupOrders(tx, order.checkoutGroupId);

      const flipped = await this.orderStatusService.transition(
        tx,
        [order.id],
        'SHIPPING',
        'COMPLETED',
        actor,
        note,
      );
      if (flipped.length === 0) throw this.alreadyChanged();

      if (isCod) await settleCodPayment(tx, order.checkoutGroupId);
    });
  }

  // --- Dùng chung -----------------------------------------------------------------------------

  private async changeStatus(
    scope: OrderScope,
    from: OrderStatus,
    to: OrderStatus,
    actor: OrderActor,
    options: ChangeStatusOptions = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, scope);
      options.precheck?.(order);
      if (order.status !== from) throw this.invalidTransition(order);

      const flipped = await this.orderStatusService.transition(
        tx,
        [order.id],
        from,
        to,
        actor,
        options.note,
      );
      if (flipped.length === 0) throw this.alreadyChanged();

      await options.after?.(tx, order);
    });
  }

  private async load(tx: TxClient, scope: OrderScope): Promise<LoadedOrder> {
    const order = await tx.order.findFirst({
      where: scope,
      select: actionOrderSelect,
    });
    if (!order) throw orderNotFound();
    return {
      ...order,
      paymentMethod: order.checkoutGroup.payments[0]?.method ?? null,
    };
  }

  // Seller đọc đơn theo ĐÚNG phạm vi (shop mình + trạng thái Seller được thấy): đơn chưa thanh toán / thuộc
  // shop khác / không tồn tại cùng 404.
  private async findSellerOrderHead(shopId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: sellerScope(shopId, orderId),
      select: { status: true },
    });
    if (!order) throw orderNotFound();
    return order;
  }

  // Vì sao đơn ở `status` không hủy/từ chối NGAY được: đã xác nhận/đóng gói (người mua gửi yêu cầu hủy, seller
  // dùng "hủy đơn"), đã giao cho vận chuyển (ORDER_CANCEL_NOT_ALLOWED), hoặc sai trạng thái / đã kết thúc
  // (ORDER_INVALID_TRANSITION — kể cả PENDING ở đường seller tự hủy: dùng "từ chối").
  private cancelRefused(status: OrderStatus): AppException {
    const reason = getCancelBlockReason(status);
    if (reason) {
      return new AppException(
        409,
        'ORDER_CANCEL_NOT_ALLOWED',
        `Order cannot be cancelled: ${reason}`,
        { reason },
      );
    }
    return new AppException(
      409,
      'ORDER_INVALID_TRANSITION',
      `Action is not allowed while the order is ${status}`,
    );
  }

  private async assertNoPendingCancelRequest(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const requests = await tx.refundRequest.findMany({
      where: { orderId, status: { not: 'WITHDRAWN' } },
      select: { kind: true, status: true },
    });
    if (
      requests.some((request) =>
        blocksSellerFulfilment(request.kind, request.status),
      )
    ) {
      throw new AppException(
        409,
        'REFUND_REQUEST_PENDING',
        'The buyer has asked to cancel this order — respond to the request first',
      );
    }
  }

  private invalidTransition(order: LoadedOrder): AppException {
    return new AppException(
      409,
      'ORDER_INVALID_TRANSITION',
      `Action is not allowed while the order is ${order.status}`,
    );
  }

  private alreadyChanged(): AppException {
    return new AppException(
      409,
      'ORDER_ALREADY_CHANGED',
      'Order status was changed by another request',
    );
  }
}
