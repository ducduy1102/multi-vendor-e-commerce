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
  buyerName: string;
  // Link tới trang đơn hàng của FE.
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

export type OrderCancelledBy = 'SELLER' | 'BUYER' | 'SYSTEM';

export interface OrderCancelledEmailData extends OrderEmailBase {
  orders: OrderEmailOrder[];
  cancelledBy: OrderCancelledBy;
  reason: string | null;
  // Tổng số tiền ĐANG được hoàn về phương thức thanh toán ban đầu (VND, Week9.md 1.5). Không có/null/0 ⇒
  // không có khoản hoàn (đơn COD chưa thu tiền, nhóm chưa thanh toán). Nội dung chỉ nói "đang hoàn" chứ không
  // khẳng định đã hoàn — cổng có thể chậm hoặc lỗi.
  refundAmount?: number | null;
}
