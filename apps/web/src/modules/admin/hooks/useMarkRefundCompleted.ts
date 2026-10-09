import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { AdminMarkRefundCompletedInput } from '../types';
import { adminRefundListsQueryKey } from './admin-query-keys';

interface MarkRefundCompletedVariables extends AdminMarkRefundCompletedInput {
  refundId: string;
}

// Ghi nhận khoản hoàn đã làm tay trên trang merchant của cổng, kèm mã tham chiếu bắt buộc. `refundId` truyền
// lúc `mutate`, tách khỏi body: service nhận (refundId, { reference }). Làm mới MỌI danh sách sổ cái, thành
// công hay thất bại (cùng lý do với useRetryRefund).
export function useMarkRefundCompleted() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminRefundListsQueryKey() });

  return useMutation({
    mutationFn: ({ refundId, ...input }: MarkRefundCompletedVariables) =>
      adminService.markRefundCompleted(refundId, input),
    onSuccess: refresh,
    onError: refresh,
  });
}
