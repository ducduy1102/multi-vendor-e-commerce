// Dùng thẳng schema BE — các form hủy/từ chối/giao hàng không có field riêng ở FE, nên chỉ
// re-export (message lỗi là key i18n `order.validation*`, dịch khi hiển thị). `""` từ input bỏ
// trống đã được schema coi là chưa nhập (transform ở cuối chain, tương thích zodResolver).
export {
  ORDER_REASON_MAX_LENGTH,
  ORDER_SHIPPING_FIELD_MAX_LENGTH,
  cancelOrderSchema,
  rejectOrderSchema,
  shipOrderSchema,
} from '@ecommerce/types';
