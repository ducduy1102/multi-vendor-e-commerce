import type { OrderStatus, OrderTab } from './types';

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

export const PAYMENT_METHOD_LABEL_KEYS = {
  VNPAY: 'paymentMethodVnpay',
  MOMO: 'paymentMethodMomo',
  COD: 'paymentMethodCod',
} as const;
