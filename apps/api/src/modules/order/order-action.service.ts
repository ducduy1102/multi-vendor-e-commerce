import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import type { ShipOrderInput } from '@ecommerce/types';
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

// Đơn cần cho 1 hành động: định danh + đủ dữ kiện để kiểm luật và hoàn kho. Đọc 1 lần ở đầu mỗi
// transaction (không khoá) — câu UPDATE có điều kiện của OrderStatusService mới là trọng tài.
const actionOrderSelect = {
  id: true,
  status: true,
  checkoutGroupId: true,
  items: { select: { productVariantId: true, quantity: true } },
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
  // Đơn COD: khoá cả nhóm (id tăng dần) TRƯỚC khi chuyển, vì `after` đọc tổng hợp các đơn anh em (chốt Payment
  // COD, trả lượt voucher) — hai đơn cùng nhóm hủy đồng thời mà không khoá sẽ cùng thấy "đơn kia còn sống"
  // và không bên nào chốt (write skew, note-nestjs.md AV).
  lockCodGroup?: boolean;
  // Chạy SAU khi chuyển trạng thái thành công, trong CÙNG transaction (hoàn kho, ghi vận chuyển...).
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

  pack(shopId: string, sellerUserId: string, orderId: string): Promise<void> {
    return this.changeStatus(
      sellerScope(shopId, orderId),
      'CONFIRMED',
      'PACKED',
      {
        type: 'SELLER',
        id: sellerUserId,
      },
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

  // Từ chối đơn: chỉ COD chờ xác nhận (chưa thu tiền). Đơn đã trả online từ chối kèm hoàn tiền: Tuần 9.
  async reject(
    shopId: string,
    sellerUserId: string,
    orderId: string,
    reason: string,
  ): Promise<void> {
    await this.changeStatus(
      sellerScope(shopId, orderId),
      'PENDING',
      'CANCELLED',
      { type: 'SELLER', id: sellerUserId },
      {
        note: reason,
        precheck: (order) => this.assertCancellable(order),
        lockCodGroup: true,
        after: (tx, order) => this.afterCodOrderCancelled(tx, order),
      },
    );
    await this.orderEmailService.notifyCancelled(
      { orderIds: [orderId] },
      'SELLER',
      reason,
    );
  }

  // --- Buyer ----------------------------------------------------------------------------------

  // Hủy đơn của mình. Đơn chưa thanh toán ⇒ hủy cả NHÓM thanh toán (1 Payment cho cả nhóm); đơn COD
  // chờ xác nhận ⇒ hủy đơn đó và hoàn kho. Đơn đã trả online / đã xác nhận trở đi ⇒ 409
  // ORDER_CANCEL_NOT_ALLOWED (hủy kèm hoàn tiền: Tuần 9).
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

    await this.changeStatus(
      { id: orderId, userId },
      'PENDING',
      'CANCELLED',
      { type: 'BUYER', id: userId },
      {
        // Chỉ lý do do chính buyer nhập; không có thì để trống (null) — KHÔNG ghi chuỗi mặc định, vì
        // `note` của buyer được hiển thị nguyên văn cho shop và cho chính buyer.
        note: reason,
        precheck: (order) => this.assertCancellable(order),
        lockCodGroup: true,
        after: (tx, order) => this.afterCodOrderCancelled(tx, order),
      },
    );
    // Nhóm chưa thanh toán đã được báo ở reclaimCheckoutGroup (nhánh trên); đây là đơn COD hủy lẻ.
    await this.orderEmailService.notifyCancelled(
      { orderIds: [orderId] },
      'BUYER',
      reason ?? null,
    );
  }

  // Buyer xác nhận đã nhận hàng: SHIPPING → COMPLETED. Với COD, đây là lúc thu tiền: khi mọi đơn
  // không bị hủy của nhóm đã COMPLETED ⇒ Payment COD → SUCCESS (Week8.md 1.6). Điều kiện được kiểm lại
  // cả khi một đơn COD của nhóm bị hủy/từ chối (afterCodOrderCancelled) vì đó có thể là đơn cuối cùng.
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

      if (options.lockCodGroup && order.paymentMethod === 'COD') {
        await lockGroupOrders(tx, order.checkoutGroupId);
      }
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

  private assertCancellable(order: LoadedOrder): void {
    const reason = getCancelBlockReason(order.status, order.paymentMethod);
    if (reason) {
      throw new AppException(
        409,
        'ORDER_CANCEL_NOT_ALLOWED',
        `Order cannot be cancelled: ${reason}`,
        { reason },
      );
    }
  }

  // Đơn COD bị hủy/từ chối (hiện chỉ còn đường PENDING → CANCELLED): hoàn kho + trả lượt voucher nếu nhóm không
  // còn đơn nào hưởng giảm giá (RefundService.applyCancellationEffects — một nơi duy nhất cho tác dụng phụ của
  // hủy trước giao, Week9.md 1.7), rồi kiểm lại điều kiện chốt Payment COD của nhóm. Đơn bị hủy có thể chính là
  // đơn CUỐI CÙNG chưa tới đích — các đơn còn lại đã COMPLETED từ trước và lúc đó nhóm còn đơn này nên chưa thu
  // tiền; nếu không kiểm lại ở đây, Payment COD kẹt PENDING mãi dù mọi đơn đã tới đích (phát hiện khi test tay
  // 3.12). Cả nhóm đã được khoá (lockCodGroup) trước khi chuyển nên hai đơn cùng nhóm hủy/hoàn tất đồng thời xếp
  // hàng nhau và bên commit sau luôn thấy kết quả của bên trước.
  private async afterCodOrderCancelled(
    tx: TxClient,
    order: LoadedOrder,
  ): Promise<void> {
    await this.refundService.applyCancellationEffects(tx, order);
    if (order.paymentMethod === 'COD') {
      await settleCodPayment(tx, order.checkoutGroupId);
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
