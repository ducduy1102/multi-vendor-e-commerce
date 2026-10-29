import {
  clipNotificationLabel,
  clipOptionalNotificationLabel,
  NOTIFICATION_LABEL_MAX_LENGTH,
  NOTIFICATION_REASON_MAX_LENGTH,
  type NotificationContent,
  type NotificationData,
  type NotificationType,
  type OrderActorType,
  type RefundRequestKind,
  type ShopStatus,
} from '@ecommerce/types';

// Sự kiện miền → thông báo (Week10.md 7.3). Nơi gọi KHÔNG tạo hàng thông báo: nó chỉ nói "điều này vừa xảy ra"
// bằng một sự kiện có kiểu (id + ngữ cảnh chỉ nơi gọi biết, vd ai hủy và vì sao), còn NGƯỜI NHẬN và DỮ LIỆU hiển thị
// luôn do NotificationService suy ra từ DB — không bao giờ nhận từ client (chặn gửi thông báo giả vào hộp thư người
// khác) và không để mỗi nơi gọi tự nhớ "ai cần biết điều này". Đổi sang outbox/broker sau này chỉ thay thân
// `NotificationService.notify`, không sửa nơi gọi (rules "Nguyên tắc để tách microservice sau", Week10.md).

// Đích của một lần hủy: danh sách đơn cụ thể, hoặc cả nhóm thanh toán (chỉ lấy các đơn ĐÃ CANCELLED của nhóm) —
// cùng quy ước với OrderEmailService.notifyCancelled.
export type CancelledTarget =
  { orderIds: string[] } | { checkoutGroupId: string };

export type NotificationEvent =
  // Đơn mới tới shop: COD vừa đặt, hoặc đơn online vừa thanh toán xong. Cả nhóm; chỉ shop có đơn ĐÃ vào PENDING được báo.
  | { kind: 'ORDERS_PLACED'; checkoutGroupId: string }
  | { kind: 'ORDER_CONFIRMED'; orderId: string }
  | { kind: 'ORDER_SHIPPED'; orderId: string }
  // Hệ thống tự hoàn tất đơn đã giao (người mua tự bấm "đã nhận" thì không cần báo lại).
  | { kind: 'ORDER_AUTO_COMPLETED'; orderId: string }
  // `by` = ai hủy. `reason` = lý do người hủy nhập (có thể rất dài/nhiều dòng — được cắt gọn). `closedRefundRequest` =
  // lần hủy này là hệ quả của việc DUYỆT một yêu cầu hủy: người mua đã có thông báo "yêu cầu được duyệt" nên không báo
  // thêm "đơn đã hủy" (một việc, hai thông báo là nhiễu).
  | {
      kind: 'ORDERS_CANCELLED';
      target: CancelledTarget;
      by: OrderActorType;
      reason?: string | null;
      closedRefundRequest?: boolean;
    }
  | { kind: 'REFUND_REQUEST_CREATED'; refundRequestId: string }
  | { kind: 'REFUND_REQUEST_APPROVED'; refundRequestId: string }
  | {
      kind: 'REFUND_REQUEST_REJECTED';
      refundRequestId: string;
      // Lý do do shop/Admin nhập khi từ chối (nằm ở RefundRequestHistory.note, nơi gọi truyền vào).
      reason?: string | null;
    }
  | { kind: 'REFUND_REQUEST_ESCALATED'; refundRequestId: string }
  | {
      kind: 'REFUND_REQUEST_DECIDED_BY_ADMIN';
      refundRequestId: string;
      outcome: 'APPROVED' | 'REJECTED';
    }
  // Khoản hoàn tiền ra khỏi hệ thống đã thành công (PaymentRefund SUCCEEDED).
  | { kind: 'REFUND_COMPLETED'; orderId: string }
  | { kind: 'REVIEW_CREATED'; reviewId: string }
  | { kind: 'REVIEW_REPLIED'; reviewId: string }
  | {
      kind: 'SHOP_STATUS_CHANGED';
      shopId: string;
      status: ShopStatus;
      reason?: string | null;
    }
  // Shop mới tạo / nộp lại, đang chờ Admin duyệt.
  | { kind: 'SHOP_SUBMITTED'; shopId: string }
  // Chủ shop vừa gửi kháng nghị lần khoá shop (Week11.md 4.6): báo mọi Admin ACTIVE. Chỉ id — không kèm lời kháng nghị.
  | { kind: 'APPEAL_SUBMITTED'; appealId: string; shopId: string }
  // Admin đã quyết định một kháng nghị: báo chủ shop (suy từ shop, không từ sự kiện). `decision` là kết quả đã ghi.
  | {
      kind: 'APPEAL_DECIDED';
      appealId: string;
      shopId: string;
      decision: 'ACCEPTED' | 'REJECTED';
    };

export type NotificationEventKind = NotificationEvent['kind'];

// Dữ kiện đã tải từ DB để quyết định người nhận. Chỉ id và nhãn: không email, SĐT, địa chỉ hay nội dung tin nhắn.
export interface OrderFacts {
  orderId: string;
  buyerId: string;
  shopOwnerId: string;
  shopName: string;
  // Đơn ĐÃ TỪNG ở PENDING (đã thanh toán / COD đã đặt) tức shop đã từng thấy nó. Đơn chưa từng được thanh toán rồi
  // bị hủy thì shop chưa bao giờ biết tới — không được lộ cho chủ shop qua thông báo (cùng luật với
  // sellerVisibleOrderFilter ở modules/order, Week7.md 1.13).
  visibleToSeller: boolean;
}

export interface RefundRequestFacts {
  orderId: string;
  kind: RefundRequestKind;
  buyerId: string;
  shopOwnerId: string;
}

export interface ReviewFacts {
  productId: string;
  productName: string;
  rating: number;
  reviewerId: string;
  shopOwnerId: string;
  shopName: string;
}

export interface ShopFacts {
  shopId: string;
  shopName: string;
  ownerId: string;
}

export type NotificationFacts =
  | { kind: 'ORDERS'; orders: OrderFacts[] }
  | { kind: 'REFUND_REQUEST'; request: RefundRequestFacts; adminIds: string[] }
  | { kind: 'REVIEW'; review: ReviewFacts }
  | { kind: 'SHOP'; shop: ShopFacts; adminIds: string[] };

// Một thông báo sắp ghi: người nhận + nội dung `{ type, data }` đúng hình dạng đã chốt ở packages/types.
export type NotificationDraft = { userId: string } & NotificationContent;

// Hàm dựng có kiểu theo từng loại; ép về union một lần ở đây vì TypeScript không tương quan được generic `T` với
// phần tử của union phân biệt. Schema ghi (notificationWriteSchema) vẫn kiểm lại hình dạng lúc chạy.
function draft<T extends NotificationType>(
  userId: string,
  type: T,
  data: NotificationData<T>,
): NotificationDraft {
  return { userId, type, data } as NotificationDraft;
}

const label = (value: string) =>
  clipNotificationLabel(value, NOTIFICATION_LABEL_MAX_LENGTH);
const reasonOf = (value: string | null | undefined) =>
  clipOptionalNotificationLabel(value, NOTIFICATION_REASON_MAX_LENGTH);

function expectFacts<K extends NotificationFacts['kind']>(
  event: NotificationEvent,
  facts: NotificationFacts,
  kind: K,
): Extract<NotificationFacts, { kind: K }> {
  if (facts.kind !== kind) {
    throw new Error(
      `Notification event ${event.kind} needs ${kind} facts, got ${facts.kind}`,
    );
  }
  return facts as Extract<NotificationFacts, { kind: K }>;
}

// Chủ shop có cần được báo một đơn bị hủy không (đơn đã là đơn của shop)? Không báo khi chính shop hủy (đã biết), và
// không báo khi Admin hủy kèm duyệt một yêu cầu (REFUND_REQUEST_DECIDED_BY_ADMIN đã báo). Người mua hủy, hệ thống hủy
// (vd quá hạn phản hồi yêu cầu hủy) hay Admin hủy trực tiếp thì shop cần biết.
function sellerShouldKnowAboutCancel(
  by: OrderActorType,
  closedRefundRequest: boolean,
): boolean {
  if (by === 'SELLER') return false;
  if (by === 'ADMIN') return !closedRefundRequest;
  return true; // BUYER, SYSTEM
}

// Sự kiện + dữ kiện → danh sách thông báo (HÀM THUẦN, không DB/đồng hồ/ngẫu nhiên): toàn bộ quyết định "ai nhận
// gì" nằm ở đây nên kiểm thử bằng bảng (notification-events.spec.ts). Chữ do người dùng nhập (tên shop/sản phẩm, lý
// do) luôn được cắt gọn thành nhãn một dòng hợp lệ ở đây, để một lý do dài không làm `notify` thất bại.
export function buildNotifications(
  event: NotificationEvent,
  facts: NotificationFacts,
): NotificationDraft[] {
  return dedupe(buildRaw(event, facts));
}

function buildRaw(
  event: NotificationEvent,
  facts: NotificationFacts,
): NotificationDraft[] {
  switch (event.kind) {
    case 'ORDERS_PLACED':
      return expectFacts(event, facts, 'ORDERS')
        .orders.filter((order) => order.visibleToSeller)
        .map((order) =>
          draft(order.shopOwnerId, 'ORDER_NEW', { orderId: order.orderId }),
        );

    case 'ORDER_CONFIRMED':
      return expectFacts(event, facts, 'ORDERS').orders.map((order) =>
        draft(order.buyerId, 'ORDER_CONFIRMED', {
          orderId: order.orderId,
          shopName: label(order.shopName),
        }),
      );

    case 'ORDER_SHIPPED':
      return expectFacts(event, facts, 'ORDERS').orders.map((order) =>
        draft(order.buyerId, 'ORDER_SHIPPED', {
          orderId: order.orderId,
          shopName: label(order.shopName),
        }),
      );

    case 'ORDER_AUTO_COMPLETED':
      return expectFacts(event, facts, 'ORDERS').orders.map((order) =>
        draft(order.buyerId, 'ORDER_COMPLETED', {
          orderId: order.orderId,
          shopName: label(order.shopName),
        }),
      );

    case 'ORDERS_CANCELLED': {
      const reason = reasonOf(event.reason);
      const closed = event.closedRefundRequest === true;
      return expectFacts(event, facts, 'ORDERS').orders.flatMap((order) => {
        const shopName = label(order.shopName);
        const toBuyer = closed
          ? []
          : [
              draft(order.buyerId, 'ORDER_CANCELLED', {
                orderId: order.orderId,
                audience: 'BUYER',
                by: event.by,
                shopName,
                ...(reason ? { reason } : {}),
              }),
            ];
        const toShop =
          order.visibleToSeller && sellerShouldKnowAboutCancel(event.by, closed)
            ? [
                draft(order.shopOwnerId, 'ORDER_CANCELLED', {
                  orderId: order.orderId,
                  audience: 'SELLER',
                  by: event.by,
                  shopName,
                  ...(reason ? { reason } : {}),
                }),
              ]
            : [];
        return [...toBuyer, ...toShop];
      });
    }

    case 'REFUND_REQUEST_CREATED': {
      const { request } = expectFacts(event, facts, 'REFUND_REQUEST');
      return [
        draft(request.shopOwnerId, 'REFUND_REQUEST_NEW', {
          orderId: request.orderId,
          kind: request.kind,
        }),
      ];
    }

    case 'REFUND_REQUEST_APPROVED': {
      const { request } = expectFacts(event, facts, 'REFUND_REQUEST');
      return [
        draft(request.buyerId, 'REFUND_REQUEST_APPROVED', {
          orderId: request.orderId,
          kind: request.kind,
        }),
      ];
    }

    case 'REFUND_REQUEST_REJECTED': {
      const { request } = expectFacts(event, facts, 'REFUND_REQUEST');
      const reason = reasonOf(event.reason);
      return [
        draft(request.buyerId, 'REFUND_REQUEST_REJECTED', {
          orderId: request.orderId,
          kind: request.kind,
          ...(reason ? { reason } : {}),
        }),
      ];
    }

    case 'REFUND_REQUEST_ESCALATED': {
      const { request, adminIds } = expectFacts(event, facts, 'REFUND_REQUEST');
      return [
        ...adminIds.map((adminId) =>
          draft(adminId, 'REFUND_REQUEST_ESCALATED', {
            orderId: request.orderId,
            kind: request.kind,
            audience: 'ADMIN',
          }),
        ),
        draft(request.shopOwnerId, 'REFUND_REQUEST_ESCALATED', {
          orderId: request.orderId,
          kind: request.kind,
          audience: 'SELLER',
        }),
      ];
    }

    case 'REFUND_REQUEST_DECIDED_BY_ADMIN': {
      const { request } = expectFacts(event, facts, 'REFUND_REQUEST');
      return [
        draft(request.shopOwnerId, 'REFUND_REQUEST_DECIDED_BY_ADMIN', {
          orderId: request.orderId,
          kind: request.kind,
          outcome: event.outcome,
        }),
      ];
    }

    case 'REFUND_COMPLETED':
      return expectFacts(event, facts, 'ORDERS').orders.map((order) =>
        draft(order.buyerId, 'REFUND_COMPLETED', { orderId: order.orderId }),
      );

    case 'REVIEW_CREATED': {
      const { review } = expectFacts(event, facts, 'REVIEW');
      return [
        draft(review.shopOwnerId, 'REVIEW_NEW', {
          productId: review.productId,
          productName: label(review.productName),
          rating: review.rating,
        }),
      ];
    }

    case 'REVIEW_REPLIED': {
      const { review } = expectFacts(event, facts, 'REVIEW');
      return [
        draft(review.reviewerId, 'REVIEW_REPLIED', {
          productId: review.productId,
          productName: label(review.productName),
          shopName: label(review.shopName),
        }),
      ];
    }

    case 'SHOP_STATUS_CHANGED': {
      const { shop } = expectFacts(event, facts, 'SHOP');
      const reason = reasonOf(event.reason);
      return [
        draft(shop.ownerId, 'SHOP_STATUS_CHANGED', {
          shopId: shop.shopId,
          status: event.status,
          ...(reason ? { reason } : {}),
        }),
      ];
    }

    case 'SHOP_SUBMITTED': {
      const { shop, adminIds } = expectFacts(event, facts, 'SHOP');
      return adminIds.map((adminId) =>
        draft(adminId, 'ADMIN_SHOP_PENDING', {
          shopId: shop.shopId,
          shopName: label(shop.shopName),
        }),
      );
    }

    case 'APPEAL_SUBMITTED': {
      const { shop, adminIds } = expectFacts(event, facts, 'SHOP');
      return adminIds.map((adminId) =>
        draft(adminId, 'ADMIN_APPEAL_PENDING', {
          appealId: event.appealId,
          shopId: shop.shopId,
          shopName: label(shop.shopName),
        }),
      );
    }

    case 'APPEAL_DECIDED': {
      const { shop } = expectFacts(event, facts, 'SHOP');
      return [
        draft(shop.ownerId, 'APPEAL_DECIDED', {
          appealId: event.appealId,
          shopId: shop.shopId,
          decision: event.decision,
        }),
      ];
    }

    default: {
      // Thêm một loại sự kiện mà quên xử lý ở đây là LỖI BIÊN DỊCH (never).
      const unhandled: never = event;
      throw new Error(
        `Unhandled notification event ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

// Cùng người nhận + cùng nội dung chỉ giữ một (vd cùng một quản trị viên xuất hiện hai lần trong danh sách).
function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((item) => {
    const key = `${item.userId}|${item.type}|${JSON.stringify(item.data)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
