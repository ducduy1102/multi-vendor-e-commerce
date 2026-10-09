import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import { adminRefundListsQueryKey } from './admin-query-keys';

interface RetryRefundVariables {
  refundId: string;
}

// Gọi lại cổng cho khoản hoàn FAILED / PENDING bị bỏ dở. `refundId` truyền lúc `mutate` để 1 hook phục vụ nút
// của mọi hàng. Làm mới MỌI danh sách sổ cái, thành công hay thất bại: thành công thì khoản đã đổi trạng thái
// (rời tab "cần xử lý" nếu SUCCEEDED, vẫn ở đó nếu cổng lại từ chối — 200 nhưng `status` FAILED); thất bại
// (409 PAYMENT_REFUND_NOT_RETRYABLE — Admin khác vừa xử lý) thì danh sách đang hiển thị đã cũ.
export function useRetryRefund() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminRefundListsQueryKey() });

  return useMutation({
    mutationFn: ({ refundId }: RetryRefundVariables) => adminService.retryRefund(refundId),
    onSuccess: refresh,
    onError: refresh,
  });
}
