import type { KnownNotification, Notification } from './types';

// Ánh xạ MỘT thông báo (đã qua Zod ở service/real-time) thành thứ giao diện cần hiển thị — HÀM THUẦN, không React,
// không next-intl, không đồng hồ: icon, khoá dịch của tiêu đề/nội dung kèm tham số, và đường dẫn đích. Giao diện chỉ việc
// `t(titleKey, params)` và `<Link href>`; mọi quyết định "thông báo này nói gì, dẫn đi đâu" nằm ở đây nên kiểm thử bằng
// bảng (notification-display.test.ts).
//
// `switch` VÉT CẠN với `never` ở nhánh cuối: thêm một loại ở `NOTIFICATION_TYPES` (packages/types) mà quên ánh xạ ở đây
// là LỖI BIÊN DỊCH, không phải màn hình trống người dùng gặp. Loại lạ/dữ liệu hỏng từ BE đã được schema đọc đưa về
// `UNKNOWN` (data rỗng) và rơi về một nhãn chung, không có đường dẫn.
//
// BẢO MẬT (D10, Week10.md 8.2): `href` CHỈ dựng từ mẫu cố định + id đã kiểm lại là UUID — `data` không có trường URL nào,
// và một id sai dạng (BE lệch phiên bản, dữ liệu sửa tay) làm đường dẫn bị BỎ (`href: null`) chứ không điều hướng tới
// chuỗi lạ hay ném lỗi. Chữ lấy từ `data` (tên shop/sản phẩm, lý do) chỉ đi vào THAM SỐ dịch và luôn được render như
// text (không `dangerouslySetInnerHTML`).

export type NotificationIcon =
  'order' | 'shipping' | 'cancelled' | 'completed' | 'refund' | 'review' | 'shop' | 'info';

// Mọi khoá dịch của thông báo (namespace `notification`, phẳng camelCase theo rules/frontend.md mục 6). Khai thành union
// để một khoá gõ sai là lỗi biên dịch; test khẳng định mỗi khoá có ở cả vi lẫn en và không khoá nào bị bỏ thừa.
export const NOTIFICATION_MESSAGE_KEYS = [
  'titleOrderNew',
  'bodyOrderNew',
  'titleOrderConfirmed',
  'bodyOrderConfirmed',
  'titleOrderShipped',
  'bodyOrderShipped',
  'titleOrderCancelled',
  'bodyOrderCancelledBuyerBySeller',
  'bodyOrderCancelledBuyerByBuyer',
  'bodyOrderCancelledBuyerBySystem',
  'bodyOrderCancelledBuyerByAdmin',
  'bodyOrderCancelledSellerByBuyer',
  'bodyOrderCancelledSellerBySeller',
  'bodyOrderCancelledSellerBySystem',
  'bodyOrderCancelledSellerByAdmin',
  'titleOrderCompleted',
  'bodyOrderCompleted',
  'titleRefundRequestNew',
  'bodyRefundRequestNew',
  'titleRefundRequestApproved',
  'bodyRefundRequestApproved',
  'titleRefundRequestRejected',
  'bodyRefundRequestRejected',
  'titleRefundRequestEscalated',
  'bodyRefundRequestEscalatedAdmin',
  'bodyRefundRequestEscalatedSeller',
  'titleRefundDecidedByAdmin',
  'bodyRefundDecidedByAdmin',
  'titleRefundCompleted',
  'bodyRefundCompleted',
  'titleReviewNew',
  'bodyReviewNew',
  'titleReviewReplied',
  'bodyReviewReplied',
  'titleShopStatusChanged',
  'bodyShopStatusChanged',
  'titleAdminShopPending',
  'bodyAdminShopPending',
  'titleAdminAppealPending',
  'bodyAdminAppealPending',
  'titleAppealAccepted',
  'bodyAppealAccepted',
  'titleAppealRejected',
  'bodyAppealRejected',
  'titleReportNew',
  'bodyReportNewReview',
  'bodyReportNewConversation',
  'bodyReportNewShop',
  'bodyReportNewProduct',
  'titleReportResolved',
  'bodyReportResolved',
  'bodyReportDismissed',
  'titleReviewHidden',
  'bodyReviewHidden',
  'titleProductTakenDown',
  'bodyProductTakenDown',
  'titleUnknown',
  'bodyUnknown',
] as const;
export type NotificationMessageKey = (typeof NOTIFICATION_MESSAGE_KEYS)[number];

export type NotificationParams = Record<string, string | number>;

export interface NotificationDisplay {
  icon: NotificationIcon;
  titleKey: NotificationMessageKey;
  bodyKey: NotificationMessageKey;
  // Tham số cho `t(key, params)`. Mọi tham số đều là chuỗi/số đã chuẩn bị sẵn (xem `reasonParams`, `orderCode`).
  params: NotificationParams;
  // Đường dẫn nội bộ (chưa có tiền tố ngôn ngữ — `Link` của `@/i18n/navigation` tự thêm) hoặc null khi không có/không an
  // toàn để dẫn đi.
  href: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mã đơn hiển thị = 8 ký tự đầu của id đơn — đúng cách các màn đơn hàng của người bán đang hiển thị (SellerOrderCard) để
// người dùng đối chiếu được thông báo với danh sách. (`notification` không được import module `order` nên tự suy ra.)
const SHORT_ORDER_CODE_LENGTH = 8;
const orderCode = (orderId: string): string => orderId.slice(0, SHORT_ORDER_CODE_LENGTH);

// Dựng đường dẫn từ mẫu cố định + MỘT id đã kiểm là UUID; id sai dạng ⇒ null (không dẫn đi đâu).
function pathWithId(prefix: string, id: string): string | null {
  return UUID_PATTERN.test(id) ? `${prefix}/${id}` : null;
}

// `{hasReason, select, yes {… {reason}} other {}}` ở bản dịch: tách cờ khỏi nội dung để một lý do tình cờ trùng từ khoá
// của `select` (vd "other") không làm sai nhánh.
function reasonParams(reason: string | undefined): NotificationParams {
  return reason ? { hasReason: 'yes', reason } : { hasReason: 'no', reason: '' };
}

// Câu của thông báo báo cáo mới theo loại đối tượng.
const REPORT_NEW_BODY_KEYS = {
  REVIEW: 'bodyReportNewReview',
  CONVERSATION: 'bodyReportNewConversation',
  SHOP: 'bodyReportNewShop',
  PRODUCT: 'bodyReportNewProduct',
} as const satisfies Record<'REVIEW' | 'CONVERSATION' | 'SHOP' | 'PRODUCT', NotificationMessageKey>;

type Known = KnownNotification;
type Of<T extends Known['type']> = Extract<Known, { type: T }>;

const UNKNOWN_DISPLAY: NotificationDisplay = {
  icon: 'info',
  titleKey: 'titleUnknown',
  bodyKey: 'bodyUnknown',
  params: {},
  href: null,
};

function describeOrderCancelled(n: Of<'ORDER_CANCELLED'>): NotificationDisplay {
  const { orderId, audience, by, shopName, reason } = n.data;
  const bodyKeys = {
    BUYER: {
      SELLER: 'bodyOrderCancelledBuyerBySeller',
      BUYER: 'bodyOrderCancelledBuyerByBuyer',
      SYSTEM: 'bodyOrderCancelledBuyerBySystem',
      ADMIN: 'bodyOrderCancelledBuyerByAdmin',
    },
    SELLER: {
      BUYER: 'bodyOrderCancelledSellerByBuyer',
      SELLER: 'bodyOrderCancelledSellerBySeller',
      SYSTEM: 'bodyOrderCancelledSellerBySystem',
      ADMIN: 'bodyOrderCancelledSellerByAdmin',
    },
  } as const satisfies Record<'BUYER' | 'SELLER', Record<typeof by, NotificationMessageKey>>;

  return {
    icon: 'cancelled',
    titleKey: 'titleOrderCancelled',
    bodyKey: bodyKeys[audience][by],
    params: { code: orderCode(orderId), shopName, ...reasonParams(reason) },
    // Người mua xem đơn ở /orders/:id, chủ shop ở /seller/orders/:id — cùng loại thông báo, KHÁC phía nhận.
    href: pathWithId(audience === 'SELLER' ? '/seller/orders' : '/orders', orderId),
  };
}

export function describeNotification(notification: Notification): NotificationDisplay {
  switch (notification.type) {
    case 'ORDER_NEW':
      return {
        icon: 'order',
        titleKey: 'titleOrderNew',
        bodyKey: 'bodyOrderNew',
        params: { code: orderCode(notification.data.orderId) },
        href: pathWithId('/seller/orders', notification.data.orderId),
      };

    case 'ORDER_CONFIRMED':
      return {
        icon: 'order',
        titleKey: 'titleOrderConfirmed',
        bodyKey: 'bodyOrderConfirmed',
        params: {
          code: orderCode(notification.data.orderId),
          shopName: notification.data.shopName,
        },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'ORDER_SHIPPED':
      return {
        icon: 'shipping',
        titleKey: 'titleOrderShipped',
        bodyKey: 'bodyOrderShipped',
        params: {
          code: orderCode(notification.data.orderId),
          shopName: notification.data.shopName,
        },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'ORDER_CANCELLED':
      return describeOrderCancelled(notification);

    case 'ORDER_COMPLETED':
      return {
        icon: 'completed',
        titleKey: 'titleOrderCompleted',
        bodyKey: 'bodyOrderCompleted',
        params: {
          code: orderCode(notification.data.orderId),
          shopName: notification.data.shopName,
        },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'REFUND_REQUEST_NEW':
      return {
        icon: 'refund',
        titleKey: 'titleRefundRequestNew',
        bodyKey: 'bodyRefundRequestNew',
        params: { code: orderCode(notification.data.orderId), kind: notification.data.kind },
        href: '/seller/refund-requests',
      };

    case 'REFUND_REQUEST_APPROVED':
      return {
        icon: 'refund',
        titleKey: 'titleRefundRequestApproved',
        bodyKey: 'bodyRefundRequestApproved',
        params: { code: orderCode(notification.data.orderId), kind: notification.data.kind },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'REFUND_REQUEST_REJECTED':
      return {
        icon: 'refund',
        titleKey: 'titleRefundRequestRejected',
        bodyKey: 'bodyRefundRequestRejected',
        params: {
          code: orderCode(notification.data.orderId),
          kind: notification.data.kind,
          ...reasonParams(notification.data.reason),
        },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'REFUND_REQUEST_ESCALATED':
      return {
        icon: 'refund',
        titleKey: 'titleRefundRequestEscalated',
        bodyKey:
          notification.data.audience === 'ADMIN'
            ? 'bodyRefundRequestEscalatedAdmin'
            : 'bodyRefundRequestEscalatedSeller',
        params: { code: orderCode(notification.data.orderId), kind: notification.data.kind },
        // Admin xử lý ở hàng chờ khiếu nại của sàn; chủ shop xem ở hàng chờ yêu cầu của shop mình.
        href: notification.data.audience === 'ADMIN' ? '/admin/refunds' : '/seller/refund-requests',
      };

    case 'REFUND_REQUEST_DECIDED_BY_ADMIN':
      return {
        icon: 'refund',
        titleKey: 'titleRefundDecidedByAdmin',
        bodyKey: 'bodyRefundDecidedByAdmin',
        params: {
          code: orderCode(notification.data.orderId),
          kind: notification.data.kind,
          outcome: notification.data.outcome,
        },
        href: '/seller/refund-requests',
      };

    case 'REFUND_COMPLETED':
      return {
        icon: 'refund',
        titleKey: 'titleRefundCompleted',
        bodyKey: 'bodyRefundCompleted',
        params: { code: orderCode(notification.data.orderId) },
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'REVIEW_NEW':
      return {
        icon: 'review',
        titleKey: 'titleReviewNew',
        bodyKey: 'bodyReviewNew',
        params: { productName: notification.data.productName, rating: notification.data.rating },
        href: '/seller/reviews',
      };

    case 'REVIEW_REPLIED':
      return {
        icon: 'review',
        titleKey: 'titleReviewReplied',
        bodyKey: 'bodyReviewReplied',
        params: {
          productName: notification.data.productName,
          shopName: notification.data.shopName,
        },
        // Trang sản phẩm nhận cả id lẫn slug (BE `GET /products/:idOrSlug`).
        href: pathWithId('/products', notification.data.productId),
      };

    case 'SHOP_STATUS_CHANGED':
      return {
        icon: 'shop',
        titleKey: 'titleShopStatusChanged',
        bodyKey: 'bodyShopStatusChanged',
        params: { status: notification.data.status, ...reasonParams(notification.data.reason) },
        href: '/seller/shop',
      };

    case 'ADMIN_SHOP_PENDING':
      return {
        icon: 'shop',
        titleKey: 'titleAdminShopPending',
        bodyKey: 'bodyAdminShopPending',
        params: { shopName: notification.data.shopName },
        // Tab mặc định của /admin/shops là "Chờ duyệt".
        href: '/admin/shops',
      };

    case 'ADMIN_APPEAL_PENDING':
      return {
        icon: 'shop',
        titleKey: 'titleAdminAppealPending',
        bodyKey: 'bodyAdminAppealPending',
        params: { shopName: notification.data.shopName },
        // Hàng đợi kháng nghị của sàn, tab mặc định là "Chờ xử lý".
        href: '/admin/appeals',
      };

    case 'APPEAL_DECIDED':
      return {
        icon: 'shop',
        // Mỗi kết quả một cặp tiêu đề/nội dung trọn vẹn (không `select`): chủ shop thấy ngay kết quả, ghi chú của Admin nằm ở
        // trang shop chứ không trong thông báo (D15: thông báo chỉ mang id và quyết định).
        titleKey:
          notification.data.decision === 'ACCEPTED' ? 'titleAppealAccepted' : 'titleAppealRejected',
        bodyKey:
          notification.data.decision === 'ACCEPTED' ? 'bodyAppealAccepted' : 'bodyAppealRejected',
        params: {},
        href: '/seller/shop',
      };

    case 'REPORT_NEW':
      return {
        icon: 'info',
        titleKey: 'titleReportNew',
        // Mỗi loại đối tượng một câu trọn vẹn (không `select`): Admin thấy ngay báo cáo nói về cái gì. Thông báo không mang lý do,
        // ghi chú hay tên đối tượng — chúng nằm ở hàng đợi.
        bodyKey: REPORT_NEW_BODY_KEYS[notification.data.targetType],
        params: {},
        // Hàng đợi báo cáo của sàn, tab mặc định là "Chờ xử lý".
        href: '/admin/reports',
      };

    case 'REPORT_RESOLVED':
      return {
        icon: 'info',
        titleKey: 'titleReportResolved',
        // Kết quả CHUNG CHUNG (D5): đã xử lý hoặc chưa thấy vi phạm — thông báo không nêu hành động cụ thể, đối tượng hay ghi chú.
        bodyKey:
          notification.data.outcome === 'RESOLVED' ? 'bodyReportResolved' : 'bodyReportDismissed',
        params: {},
        // Người báo không có trang nào để xem lại báo cáo của mình.
        href: null,
      };

    case 'REVIEW_HIDDEN':
      return {
        icon: 'review',
        titleKey: 'titleReviewHidden',
        bodyKey: 'bodyReviewHidden',
        params: { productName: notification.data.productName },
        // Chi tiết đơn: nơi bản đánh giá của chính mình vẫn hiện, kèm nhãn "đã bị ẩn".
        href: pathWithId('/orders', notification.data.orderId),
      };

    case 'PRODUCT_TAKEN_DOWN': {
      const productPath = pathWithId('/seller/products', notification.data.productId);
      return {
        icon: 'shop',
        titleKey: 'titleProductTakenDown',
        bodyKey: 'bodyProductTakenDown',
        params: { productName: notification.data.productName, reason: notification.data.reason },
        // Trang sửa của chính sản phẩm: nơi chủ shop thấy nhãn "Bị gỡ" kèm lý do (id sai dạng ⇒ không dẫn đi đâu).
        href: productPath ? `${productPath}/edit` : null,
      };
    }

    case 'UNKNOWN':
      return UNKNOWN_DISPLAY;

    default: {
      // Thêm loại mới ở NOTIFICATION_TYPES mà quên ánh xạ ⇒ `notification` không còn là `never` ⇒ lỗi biên dịch.
      const unmapped: never = notification;
      void unmapped;
      return UNKNOWN_DISPLAY;
    }
  }
}
