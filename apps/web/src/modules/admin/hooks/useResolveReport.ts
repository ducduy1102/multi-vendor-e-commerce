import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { ResolveReportInput } from '../types';
import {
  adminOverviewQueryKey,
  adminReportDetailQueryKey,
  adminReportListsQueryKey,
  adminShopListsQueryKey,
  adminUserListsQueryKey,
} from './admin-query-keys';

interface ResolveReportVariables extends ResolveReportInput {
  reportId: string;
}

// Xử lý một báo cáo. Một hành động đóng cả các báo cáo cùng đối tượng và có thể khoá shop / tài khoản nên làm mới hàng đợi báo cáo, chi
// tiết, số việc chờ (thẻ ở /admin và số trên nav) và danh sách shop / người dùng. Làm mới cả khi LỖI: 409 thường nghĩa là Admin khác vừa
// xử lý trước, dữ liệu đang hiển thị đã cũ. Thành công thì ghi thẳng báo cáo trả về vào cache chi tiết để trang đổi sang "Kết quả xử lý"
// ngay, không chờ vòng tải lại.
export function useResolveReport() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminReportListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminOverviewQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminShopListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminUserListsQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ reportId, ...input }: ResolveReportVariables) =>
      adminService.resolveReport(reportId, input),
    onSuccess: (report, { reportId }) => {
      queryClient.setQueryData(adminReportDetailQueryKey(reportId), report);
      return invalidate();
    },
    onError: (_error, { reportId }) => {
      void queryClient.invalidateQueries({ queryKey: adminReportDetailQueryKey(reportId) });
      return invalidate();
    },
  });
}
