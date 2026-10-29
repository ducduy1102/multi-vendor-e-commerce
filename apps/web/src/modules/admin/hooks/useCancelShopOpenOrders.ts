import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import {
  adminOverviewQueryKey,
  adminRefundListsQueryKey,
  adminRefundRequestListsQueryKey,
  adminRefundablePaymentListsQueryKey,
} from './admin-query-keys';

interface CancelShopOpenOrdersVariables {
  shopId: string;
  reason: string;
}

// Hủy hàng loạt đơn chưa giao của một shop bị khoá. `shopId` truyền lúc `mutate` để một hook phục vụ nút của mọi dòng. Thành công
// hay thất bại đều làm mới các màn hoàn tiền và số việc chờ của trang tổng quan: việc hủy đã làm được TỪNG PHẦN (mỗi đơn là một
// giao dịch riêng) nên kể cả khi cả request lỗi (mất mạng giữa chừng, 409 shop vừa được mở lại), dữ liệu đang hiển thị có thể đã cũ.
// Hủy đơn tạo khoản hoàn mới ⇒ ba nhánh hoàn tiền (yêu cầu, sổ cái, thanh toán bất thường) đều có thể đổi; danh sách shop thì
// không (trạng thái shop không đổi).
export function useCancelShopOpenOrders() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminOverviewQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminRefundListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminRefundRequestListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminRefundablePaymentListsQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ shopId, reason }: CancelShopOpenOrdersVariables) =>
      adminService.cancelShopOpenOrders(shopId, { reason }),
    onSuccess: invalidate,
    onError: invalidate,
  });
}
