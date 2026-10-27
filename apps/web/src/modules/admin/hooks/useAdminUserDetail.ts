import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import { adminUserDetailQueryKey } from './admin-query-keys';

// Chi tiết người dùng cho ngăn bên phải. `userId` undefined hoặc `enabled` = false (ngăn đang đóng) ⇒ KHÔNG gọi API và
// cũng không tự tải lại khi danh sách bị làm mới; dữ liệu đã có vẫn được trả về để ngăn không bị trống giữa chừng lúc chạy
// hiệu ứng đóng. 404 (tài khoản không còn/sai đường dẫn) không thử lại nên ngăn báo "không tìm thấy" ngay, không chờ ba lần.
export function useAdminUserDetail(userId: string | undefined, enabled = true) {
  return useQuery({
    // `userId ?? ''` chỉ để khoá có đủ kiểu khi chưa có id; `enabled` đảm bảo queryFn không chạy với khoá rỗng.
    queryKey: adminUserDetailQueryKey(userId ?? ''),
    queryFn: () => adminService.getUser(userId as string),
    enabled: enabled && userId !== undefined,
    retry: shouldRetryQuery,
  });
}
