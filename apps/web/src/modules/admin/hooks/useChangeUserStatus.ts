import { useMutation, useQueryClient } from '@tanstack/react-query';

import { getSuspendTarget, type AdminUserAction } from '../admin-user-actions';
import * as adminService from '../services/admin.service';
import {
  adminShopListsQueryKey,
  adminUserDetailsQueryKey,
  adminUserListsQueryKey,
} from './admin-query-keys';

interface ChangeUserStatusVariables {
  userId: string;
  action: AdminUserAction;
  reason: string;
}

// `userId` truyền lúc `mutate` (không lúc khai hook) để một hook phục vụ nút của mọi hàng. Khoá/cấm đi
// `POST .../suspend` kèm mức (SUSPENDED/BANNED), mở lại/gỡ cấm đi `POST .../reactivate`. Thành công hay thất bại đều làm
// mới MỌI danh sách và chi tiết: thành công thì dòng đã sang trạng thái khác (rời tab hiện tại); thất bại (thường là 409 —
// Admin khác vừa xử lý tài khoản này) thì dữ liệu đang hiển thị đã cũ. Danh sách shop cũng cũ theo vì đổi trạng thái tài khoản
// kéo theo shop của họ (tạm ngừng / mở lại) ở BE.
export function useChangeUserStatus() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminUserListsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminUserDetailsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: adminShopListsQueryKey() }),
    ]);

  return useMutation({
    mutationFn: ({ userId, action, reason }: ChangeUserStatusVariables) => {
      const status = getSuspendTarget(action);
      return status
        ? adminService.suspendUser(userId, { status, reason })
        : adminService.reactivateUser(userId, { reason });
    },
    onSuccess: invalidate,
    onError: invalidate,
  });
}
