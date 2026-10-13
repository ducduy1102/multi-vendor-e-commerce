// Dùng thẳng schema BE — các form hủy/từ chối/giao hàng/yêu cầu hoàn tiền không có field riêng ở FE, nên chỉ
// re-export (message lỗi là key i18n `order.validation*`, dịch khi hiển thị). `""` từ input bỏ
// trống đã được schema coi là chưa nhập (transform ở cuối chain, tương thích zodResolver).
//
// `createRefundRequestSchema` có `superRefine` (chọn lý do OTHER thì ghi chú bắt buộc) đặt SAU object nên
// input/output type vẫn là { reasonCode, reasonNote? } — dùng thẳng cho `useForm<CreateRefundRequestInput>`.
// Danh sách lý do theo loại yêu cầu (`REFUND_REASON_CODES_BY_KIND`) để dựng <select>: loại yêu cầu do BE
// suy ra từ trạng thái đơn, FE chỉ chọn đúng tập con theo `canRequestCancel`/`canRequestReturn`.
export {
  ORDER_REASON_MAX_LENGTH,
  ORDER_SHIPPING_FIELD_MAX_LENGTH,
  REFUND_NOTE_MAX_LENGTH,
  REFUND_REASON_CODES,
  REFUND_REASON_CODES_BY_KIND,
  approveRefundRequestSchema,
  cancelOrderSchema,
  createRefundRequestSchema,
  rejectOrderSchema,
  rejectRefundRequestSchema,
  sellerCancelOrderSchema,
  shipOrderSchema,
} from '@ecommerce/types';
