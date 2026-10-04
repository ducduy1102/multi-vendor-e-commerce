import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { AdminUpdateShopStatusInput } from '../types';
import { adminShopListsQueryKey } from './admin-query-keys';

interface UpdateShopStatusVariables extends AdminUpdateShopStatusInput {
  shopId: string;
}

// `shopId` truyền lúc `mutate` (không lúc khai hook) để 1 hook phục vụ nút của mọi hàng trong danh
// sách. Thành công hay thất bại đều làm mới MỌI danh sách: thành công thì shop đã rời tab hiện tại;
// thất bại (thường là 409 — có Admin khác vừa xử lý shop này) thì danh sách đang hiển thị đã cũ.
export function useUpdateShopStatus() {
  const queryClient = useQueryClient();
  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: adminShopListsQueryKey() });

  return useMutation({
    mutationFn: ({ shopId, ...input }: UpdateShopStatusVariables) =>
      adminService.updateShopStatus(shopId, input),
    onSuccess: invalidateLists,
    onError: invalidateLists,
  });
}
