import { ApiError } from '@/shared/lib/api-client';

import type { AdminUserDetail } from './types';

export type AdminUserDetailState =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'success'; user: AdminUserDetail };

interface DetailQueryLike {
  data: AdminUserDetail | undefined;
  isError: boolean;
  error: Error | null;
}

// Trạng thái của ngăn chi tiết từ kết quả truy vấn. Có dữ liệu thì LUÔN hiện dữ liệu — lần tải lại ngầm lỗi (mạng chớp) không
// được xoá mất chi tiết đang xem; chỉ báo lỗi khi chưa có gì để hiện. 404 là kết quả chắc chắn (tài khoản không còn / đường
// dẫn sai) nên có trạng thái riêng, không bắt người xem "thử lại" một việc không bao giờ thành công.
export function getAdminUserDetailState(query: DetailQueryLike): AdminUserDetailState {
  if (query.data) return { status: 'success', user: query.data };
  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 404
      ? { status: 'not-found' }
      : { status: 'error' };
  }
  return { status: 'pending' };
}
