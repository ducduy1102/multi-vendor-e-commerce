import type { MailLocale } from '../mail-locale';

// Dữ liệu cho email đơn hàng (Week8.md 1.12). Khai ở `shared/mail` (hạ tầng không được import
// `modules/`) — module `order` tự ánh xạ dữ liệu của nó sang các kiểu này. Số tiền là số nguyên VND.

export type OrderEmailPaymentMethod = 'VNPAY' | 'MOMO' | 'COD';

export interface OrderEmailItem {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
}

export interface OrderEmailOrder {
  // Mã đơn rút gọn dễ đọc (8 ký tự đầu của id), KHÔNG phải khoá tra cứu.
  orderCode: string;
  shopName: string;
  items: OrderEmailItem[];
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
}

export interface OrderEmailBase {
  // Ngôn ngữ email = `User.locale` của người nhận (Week9.md 1.12). BẮT BUỘC (không có mặc định) để quên
  // truyền là lỗi biên dịch, không phải email tiếng Việt gửi nhầm cho người dùng tiếng Anh.
  locale: MailLocale;
  buyerName: string;
  // Link tới trang đơn hàng của FE (đã có prefix ngôn ngữ — dựng bằng `frontendUrl`).
  ordersUrl: string;
}

export interface OrderPlacedEmailData extends OrderEmailBase {
  orders: OrderEmailOrder[];
  // Quyết định cách diễn đạt: COD = "thanh toán khi nhận hàng", còn lại = "đã thanh toán".
  paymentMethod: OrderEmailPaymentMethod | null;
  recipient: { name: string; phone: string; address: string };
}

export interface OrderConfirmedEmailData extends OrderEmailBase {
  order: OrderEmailOrder;
}

export interface OrderShippedEmailData extends OrderEmailBase {
  order: OrderEmailOrder;
  carrier: string | null;
  trackingCode: string | null;
}

// ADMIN: quản trị viên của sàn hủy (hiện là hủy hàng loạt đơn chưa giao của shop bị khoá, Week11.md 4.1). Tách khỏi SYSTEM vì
// SYSTEM là hết hạn thanh toán — câu dẫn "chưa thanh toán trong thời hạn giữ hàng" sai với đơn đã trả tiền bị Admin hủy.
export type OrderCancelledBy = 'SELLER' | 'BUYER' | 'SYSTEM' | 'ADMIN';

export interface OrderCancelledEmailData extends OrderEmailBase {
  orders: OrderEmailOrder[];
  cancelledBy: OrderCancelledBy;
  reason: string | null;
  // Tổng số tiền ĐANG được hoàn về phương thức thanh toán ban đầu (VND, Week9.md 1.5). Không có/null/0 ⇒
  // không có khoản hoàn (đơn COD chưa thu tiền, nhóm chưa thanh toán). Nội dung chỉ nói "đang hoàn" chứ không
  // khẳng định đã hoàn — cổng có thể chậm hoặc lỗi.
  refundAmount?: number | null;
}

// Trả hàng/hoàn tiền SAU giao được chấp nhận (COMPLETED → REFUNDED, Week9.md 1.3). `refundTo` quyết định
// câu về tiền: đơn đã trả online ⇒ hoàn về phương thức thanh toán ban đầu (nói "đang hoàn", không khẳng định
// đã về); đơn COD ⇒ shop hoàn tiền mặt trực tiếp, hệ thống không theo dõi khoản này.
export type OrderRefundTarget = 'ORIGINAL_PAYMENT' | 'SHOP_CASH';

export interface OrderRefundedEmailData extends OrderEmailBase {
  order: OrderEmailOrder;
  refundAmount: number;
  refundTo: OrderRefundTarget;
}

// Đơn đã hoàn tất (SHIPPING → COMPLETED, Week10.md 7.5). `completedBy`: người mua tự bấm "đã nhận hàng" hay hệ thống tự
// hoàn tất sau `autoCompleteDays` ngày không xác nhận (chỉ có nghĩa ở nhánh SYSTEM, nhánh BUYER bỏ qua giá trị này).
export type OrderCompletedBy = 'BUYER' | 'SYSTEM';

export interface OrderCompletedEmailData extends OrderEmailBase {
  order: OrderEmailOrder;
  completedBy: OrderCompletedBy;
  autoCompleteDays: number;
  // Cửa sổ trả hàng/hoàn tiền còn lại, tính từ lúc hoàn tất (ngày) — REFUND_WINDOW_DAYS.
  returnWindowDays: number;
  // Còn sản phẩm của đơn mà người mua chưa đánh giá ⇒ email mời đánh giá; false ⇒ không mời.
  invitesReview: boolean;
}

// Yêu cầu hủy / trả hàng của người mua bị từ chối (Week10.md 7.5). `rejectedBy`: shop từ chối (người mua còn khiếu nại được
// trong `escalateDays` ngày) hoặc Admin (quyết định cuối, `escalateDays` bỏ qua). `reason` do shop/Admin nhập — có thể rỗng.
export type RefundRequestEmailKind = 'CANCEL' | 'RETURN';
export type RefundRequestRejectedBy = 'SELLER' | 'ADMIN';

export interface RefundRequestRejectedEmailData extends OrderEmailBase {
  order: OrderEmailOrder;
  kind: RefundRequestEmailKind;
  rejectedBy: RefundRequestRejectedBy;
  reason: string | null;
  escalateDays: number | null;
}
