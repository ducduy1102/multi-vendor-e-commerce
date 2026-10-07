import type { QueryClient } from '@tanstack/react-query';

import type { OrderDetail, SellerOrderDetail } from '../types';
import {
  orderListsQueryKey,
  orderQueryKey,
  sellerOrderListsQueryKey,
  sellerOrderQueryKey,
} from './order-query-keys';

// Mọi hành động trả lại CHI TIẾT ĐƠN MỚI NHẤT nên ghi thẳng vào cache chi tiết (không tốn thêm 1
// request), còn các danh sách (tab/trang) chỉ làm mới — đơn vừa đổi trạng thái có thể phải nhảy
// sang tab khác. Nếu hủy đơn chưa thanh toán kéo theo cả nhóm, chi tiết của các đơn còn lại trong
// nhóm tự tải lại khi mở (QueryClient mặc định staleTime = 0), không cần làm mới tay ở đây.

export function syncBuyerOrder(queryClient: QueryClient, order: OrderDetail) {
  queryClient.setQueryData(orderQueryKey(order.id), order);
  void queryClient.invalidateQueries({ queryKey: orderListsQueryKey() });
}

export function syncSellerOrder(
  queryClient: QueryClient,
  shopId: string,
  order: SellerOrderDetail,
) {
  queryClient.setQueryData(sellerOrderQueryKey(shopId, order.id), order);
  void queryClient.invalidateQueries({ queryKey: sellerOrderListsQueryKey(shopId) });
}
