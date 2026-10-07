import type { OrderStatus, Prisma } from '@prisma/client';
import { ORDER_STATUSES_VISIBLE_TO_SELLER } from '@ecommerce/types';

// ĐIỀU KIỆN DUY NHẤT cho "Seller được thấy/thao tác đơn này" — dùng ở MỌI nơi Seller đọc hoặc hành
// động trên đơn (danh sách, chi tiết, các hành động), để không nơi nào tự nhớ lại điều kiện rồi lệch:
//  1. trạng thái hiện tại không phải AWAITING_PAYMENT (đơn chưa thanh toán TUYỆT ĐỐI không lộ, nếu
//     không Seller sẽ xác nhận/giao hàng cho đơn chưa trả tiền — Week7.md 1.13), VÀ
//  2. đơn TỪNG ở trạng thái PENDING (đã thanh toán, hoặc đơn COD đã đặt — lúc đó mới tới lượt shop xử
//     lý). Đơn chưa từng được thanh toán rồi bị hủy (người mua hủy nhóm, hết hạn thanh toán) có
//     trạng thái CANCELLED nên lọt qua điều kiện 1; điều kiện 2 giữ chúng khỏi Seller: shop chưa bao
//     giờ phải xử lý đơn đó, và danh sách "Đã hủy" không nên lộ tên người nhận của người mua chưa mua.
// Đơn COD người mua hủy trước khi shop xác nhận vẫn hiện (đã từng PENDING). `tab` chỉ thu hẹp tập
// trạng thái ở điều kiện 1, không bao giờ nới điều kiện 2.
export function sellerVisibleOrderFilter(
  statuses: readonly OrderStatus[] = ORDER_STATUSES_VISIBLE_TO_SELLER,
): Prisma.OrderWhereInput {
  return {
    status: { in: [...statuses] },
    statusHistory: { some: { toStatus: 'PENDING' } },
  };
}
