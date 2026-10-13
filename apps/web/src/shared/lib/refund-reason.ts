import type { RefundReasonCode } from '@ecommerce/types';

// Nhãn lý do hủy/trả hàng theo mã — dùng chung giữa `modules/order` (người mua, shop) và `modules/admin` (màn
// khiếu nại), hai module không được import nhau nên bảng ánh xạ nằm ở shared/. Key i18n thuộc namespace `order`
// (nơi các nhãn này được dịch): nơi dùng gọi `useTranslations('order')`. Mã là chuỗi kiểm bằng Zod, không phải
// enum DB (xem packages/types/src/refund.ts). `Record<RefundReasonCode, …>` bắt TypeScript báo lỗi nếu BE thêm mã
// mà FE chưa có nhãn.
export const REFUND_REASON_LABEL_KEYS: Record<RefundReasonCode, string> = {
  CHANGE_OF_MIND: 'refundReasonChangeOfMind',
  ORDER_INFO_WRONG: 'refundReasonOrderInfoWrong',
  FOUND_CHEAPER: 'refundReasonFoundCheaper',
  DELIVERY_TOO_SLOW: 'refundReasonDeliveryTooSlow',
  DAMAGED: 'refundReasonDamaged',
  WRONG_ITEM: 'refundReasonWrongItem',
  NOT_AS_DESCRIBED: 'refundReasonNotAsDescribed',
  MISSING_ITEM: 'refundReasonMissingItem',
  OTHER: 'refundReasonOther',
};

// `reasonCode` ở response là chuỗi thường (BE thêm mã mới thì không làm hỏng cả đơn khi parse) nên có thể là
// mã FE chưa biết — rơi về nhãn "Lý do khác" thay vì hiện mã nội bộ thô cho người dùng.
export function getRefundReasonLabelKey(code: string): string {
  // hasOwnProperty chứ không phải `in`: `in` đi lên chuỗi prototype nên "toString"/"constructor" từ BE (hoặc từ
  // URL/dữ liệu lạ) sẽ trả về một HÀM thay vì nhãn.
  return Object.prototype.hasOwnProperty.call(REFUND_REASON_LABEL_KEYS, code)
    ? REFUND_REASON_LABEL_KEYS[code as RefundReasonCode]
    : REFUND_REASON_LABEL_KEYS.OTHER;
}
