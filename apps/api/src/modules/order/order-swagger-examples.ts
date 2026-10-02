import { errorExample } from '../../shared/swagger/error-examples';

// Ví dụ body lỗi dùng chung cho Swagger của BuyerOrderController và SellerOrderController. Đơn không
// tồn tại / thuộc người khác / (với Seller) chưa thanh toán đều trả CÙNG 1 body này — không phân biệt,
// để không lộ id nào có thật.
export const ORDER_NOT_FOUND_EXAMPLE = errorExample('Order not found', {
  code: 'ORDER_NOT_FOUND',
});
