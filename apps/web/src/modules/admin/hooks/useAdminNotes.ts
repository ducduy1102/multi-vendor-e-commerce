import { useInfiniteQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import { ADMIN_NOTES_PAGE_SIZE, getNextAdminNotesPage } from '../admin-notes-pages';
import * as adminService from '../services/admin.service';
import type { AdminNoteTargetType } from '../types';
import { adminNotesQueryKey } from './admin-query-keys';

interface AdminNotesTarget {
  targetType: AdminNoteTargetType;
  targetId: string;
}

// Ghi chú của một người dùng / shop, mới nhất trước, tải thêm từng trang (`fetchNextPage`). Mỗi đối tượng một khoá cache nên mở
// lại ngăn của đối tượng đã xem hiện ngay dữ liệu cũ rồi làm mới ngầm. 404 (đối tượng không còn) không thử lại.
export function useAdminNotes({ targetType, targetId }: AdminNotesTarget) {
  return useInfiniteQuery({
    queryKey: adminNotesQueryKey(targetType, targetId),
    queryFn: ({ pageParam }) =>
      adminService.listAdminNotes({
        targetType,
        targetId,
        page: pageParam,
        limit: ADMIN_NOTES_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: getNextAdminNotesPage,
    retry: shouldRetryQuery,
  });
}
