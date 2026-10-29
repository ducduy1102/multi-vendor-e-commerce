import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { DecideAppealInput } from '../types';
import {
  adminAppealListsQueryKey,
  adminOverviewQueryKey,
  adminShopListsQueryKey,
} from './admin-query-keys';

interface DecideAppealVariables extends DecideAppealInput {
  appealId: string;
}

// `appealId` truyền lúc `mutate` (không lúc khai hook) để một hook phục vụ nút của mọi hàng. Thành công hay thất bại đều làm mới
// MỌI danh sách kháng nghị: thành công thì dòng đã rời tab "Chờ xử lý"; thất bại (thường là 409 — Admin khác vừa quyết định, hoặc
// lần khoá đã kết thúc) thì danh sách đang hiển thị đã cũ. Chấp nhận còn MỞ KHOÁ shop nên danh sách shop (tab "Đã khoá" / "Đã duyệt")
// và số "việc chờ" của /admin/overview cũng cũ theo.
export function useDecideAppeal() {
  const queryClient = useQueryClient();
  const invalidateLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminAppealListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminShopListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminOverviewQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ appealId, ...input }: DecideAppealVariables) =>
      adminService.decideAppeal(appealId, input),
    onSuccess: invalidateLists,
    onError: invalidateLists,
  });
}
