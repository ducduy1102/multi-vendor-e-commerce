import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { AdminUpdateShopStatusInput } from '../types';
import { adminOverviewQueryKey, adminShopListsQueryKey } from './admin-query-keys';

interface UpdateShopStatusVariables extends AdminUpdateShopStatusInput {
  shopId: string;
}

// `shopId` truyền lúc `mutate` (không lúc khai hook) để 1 hook phục vụ nút của mọi hàng trong danh
// sách. Thành công hay thất bại đều làm mới MỌI danh sách: thành công thì shop đã rời tab hiện tại;
// thất bại (thường là 409 — có Admin khác vừa xử lý shop này) thì danh sách đang hiển thị đã cũ. Số "việc chờ"
// của /admin/overview cũng đổi theo (shop rời hàng chờ duyệt) nên làm mới cả nó.
export function useUpdateShopStatus() {
  const queryClient = useQueryClient();
  const invalidateLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminShopListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminOverviewQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ shopId, ...input }: UpdateShopStatusVariables) =>
      adminService.updateShopStatus(shopId, input),
    onSuccess: invalidateLists,
    onError: invalidateLists,
  });
}
