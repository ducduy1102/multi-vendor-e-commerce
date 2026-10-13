import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import { adminRefundListsQueryKey, adminRefundablePaymentListsQueryKey } from './admin-query-keys';

interface RefundPaymentVariables {
  paymentId: string;
  reason?: string;
}

// Hoàn một thanh toán bất thường (không đụng đơn/kho). `paymentId` truyền lúc `mutate`, tách khỏi body: service
// nhận (paymentId, { reason }). Thành công hay thất bại đều làm mới cả danh sách thanh toán bất thường lẫn sổ
// cái: thành công thì thanh toán đã có khoản hoàn (rời danh sách này) và khoản mới hiện ở sổ cái; thất bại
// (409 PAYMENT_NOT_REFUNDABLE — Admin khác vừa hoàn) thì danh sách đang hiển thị đã cũ.
export function useRefundPayment() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminRefundablePaymentListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminRefundListsQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ paymentId, reason }: RefundPaymentVariables) =>
      adminService.refundPayment(paymentId, { reason }),
    onSuccess: refresh,
    onError: refresh,
  });
}
