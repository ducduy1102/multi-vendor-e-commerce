import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { CreateAdminNoteInput } from '../types';
import { adminNotesQueryKey } from './admin-query-keys';

// Thêm một ghi chú. Thành công hay thất bại đều làm mới danh sách ghi chú của ĐÚNG đối tượng đó: thành công thì ghi chú mới phải
// hiện ở đầu danh sách (và các trang đã tải được nạp lại theo thứ tự nên không lệch); thất bại (đối tượng đã biến mất — 404) thì
// danh sách đang hiển thị đã cũ.
export function useAddAdminNote() {
  const queryClient = useQueryClient();
  const refresh = (input: CreateAdminNoteInput) =>
    queryClient.invalidateQueries({
      queryKey: adminNotesQueryKey(input.targetType, input.targetId),
    });

  return useMutation({
    mutationFn: (input: CreateAdminNoteInput) => adminService.createAdminNote(input),
    onSuccess: (_note, input) => refresh(input),
    onError: (_error, input) => refresh(input),
  });
}
