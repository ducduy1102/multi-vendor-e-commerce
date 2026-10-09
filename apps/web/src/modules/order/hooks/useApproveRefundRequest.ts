import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { sellerOrdersQueryKey } from './order-query-keys';

interface ApproveRefundRequestVariables {
  requestId: string;
  note?: string;
}

// Duyệt yêu cầu: đơn bị hủy/hoàn, kho và tiền xử lý ở BE. requestId truyền lúc mutate (1 hook phục vụ mọi
// dòng của hàng chờ). Response chỉ là chính yêu cầu đó nên không ghi được vào cache chi tiết đơn — thay vào
// đó làm mới CẢ nhánh seller của shop (hàng chờ + danh sách + chi tiết đơn), thành công hay thất bại:
// thành công thì đơn và yêu cầu đã đổi trạng thái; thất bại (409 người mua vừa rút / seller khác vừa xử
// lý / đơn vừa đổi) thì dữ liệu đang hiển thị đã cũ (note-nextjs.md #36).
export function useApproveRefundRequest(shopId: string) {
  const queryClient = useQueryClient();
  const refreshSellerOrders = () =>
    queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });

  return useMutation({
    mutationFn: ({ requestId, note }: ApproveRefundRequestVariables) =>
      orderService.approveRefundRequest(shopId, requestId, { note }),
    onSuccess: refreshSellerOrders,
    onError: refreshSellerOrders,
  });
}
