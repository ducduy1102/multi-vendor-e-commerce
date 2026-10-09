import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { AdminDecideRefundRequestInput } from '../types';
import { adminRefundListsQueryKey, adminRefundRequestListsQueryKey } from './admin-query-keys';

interface DecideRefundRequestVariables extends AdminDecideRefundRequestInput {
  requestId: string;
}

// `requestId` truyền lúc `mutate` (không lúc khai hook), tách khỏi body: service nhận (requestId,
// { decision, note }). Thành công hay thất bại đều làm mới hàng chờ lẫn sổ cái: thành công thì yêu cầu đã rời
// tab hiện tại và duyệt có thể tạo khoản hoàn mới (có khi FAILED ngay, hiện ở tab "Hoàn tiền lỗi"); thất bại
// (thường là 409 — seller/Admin khác vừa xử lý hoặc người mua vừa rút) thì danh sách đang hiển thị đã cũ
// (note-nextjs.md #36).
export function useDecideRefundRequest() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminRefundRequestListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminRefundListsQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ requestId, ...input }: DecideRefundRequestVariables) =>
      adminService.decideRefundRequest(requestId, input),
    onSuccess: refresh,
    onError: refresh,
  });
}
