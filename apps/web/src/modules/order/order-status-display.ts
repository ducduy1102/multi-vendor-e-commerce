import { orderTabSchema, sellerOrderTabSchema } from '@ecommerce/types';

import type { OrderDetail, OrderStatus, OrderTab } from './types';

// Cách hiển thị 1 trạng thái đơn: key i18n (namespace `order`) + biến thể Badge. Chỉ dùng token
// ngữ nghĩa (rules/frontend.md "UI polish" mục 2): `warning` cho việc cần người mua hành động
// (chưa thanh toán), `success` cho kết quả tốt, `destructive` KHÔNG dùng — đơn đã hủy chỉ là
// kết quả trung tính, đỏ sẽ quá ồn trong 1 danh sách dày. Accent (cam) không dùng cho trạng thái.
export type OrderBadgeTone = 'warning' | 'neutral' | 'primary' | 'success' | 'muted';

export const ORDER_STATUS_DISPLAY: Record<OrderStatus, { labelKey: string; tone: OrderBadgeTone }> =
  {
    AWAITING_PAYMENT: { labelKey: 'statusAwaitingPayment', tone: 'warning' },
    PENDING: { labelKey: 'statusPending', tone: 'neutral' },
    CONFIRMED: { labelKey: 'statusConfirmed', tone: 'neutral' },
    PACKED: { labelKey: 'statusPacked', tone: 'neutral' },
    SHIPPING: { labelKey: 'statusShipping', tone: 'primary' },
    COMPLETED: { labelKey: 'statusCompleted', tone: 'success' },
    CANCELLED: { labelKey: 'statusCancelled', tone: 'muted' },
    REFUNDED: { labelKey: 'statusRefunded', tone: 'muted' },
  };

// Nhãn tab. "all" là tab ảo (không gửi `tab` lên BE).
export type OrderTabKey = OrderTab | 'all';

export const ORDER_TAB_LABEL_KEYS: Record<OrderTabKey, string> = {
  all: 'tabAll',
  'awaiting-payment': 'tabAwaitingPayment',
  pending: 'tabPending',
  processing: 'tabProcessing',
  shipping: 'tabShipping',
  completed: 'tabCompleted',
  cancelled: 'tabCancelled',
};

// "Tất cả" đứng đầu rồi tới các tab theo đúng thứ tự enum dùng chung (BE lọc theo cùng enum). Seller
// không có tab "Chờ thanh toán" (đơn chưa trả tiền không lộ cho Seller) — loại ở mức kiểu.
export const BUYER_ORDER_TAB_KEYS: readonly OrderTabKey[] = ['all', ...orderTabSchema.options];
export const SELLER_ORDER_TAB_KEYS: readonly OrderTabKey[] = [
  'all',
  ...sellerOrderTabSchema.options,
];

export const PAYMENT_METHOD_LABEL_KEYS = {
  VNPAY: 'paymentMethodVnpay',
  MOMO: 'paymentMethodMomo',
  COD: 'paymentMethodCod',
} as const;

// Trạng thái thanh toán của NHÓM (1 Payment cho N đơn) — lần thử mới nhất. COD luôn PENDING tới khi
// đơn hoàn tất nên nhãn "Chưa thanh toán" đi kèm phương thức "Thanh toán khi nhận hàng"; nhóm COD bị hủy
// toàn bộ là CANCELLED ("Không thu", Week9.md 1.2).
export const PAYMENT_STATUS_LABEL_KEYS: Record<
  NonNullable<OrderDetail['paymentStatus']>,
  string
> = {
  PENDING: 'paymentStatusPending',
  SUCCESS: 'paymentStatusSuccess',
  FAILED: 'paymentStatusFailed',
  REFUNDED: 'paymentStatusRefunded',
  CANCELLED: 'paymentStatusCancelled',
};
