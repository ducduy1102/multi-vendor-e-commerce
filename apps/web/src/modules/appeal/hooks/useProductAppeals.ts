import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import { getProductAppeals } from '../services/appeal.service';
import { productAppealsQueryKey } from './appeal-query-keys';

// Lịch sử kháng nghị + cờ `canAppeal` của MỘT sản phẩm bị gỡ. 401/403/404 không thử lại (kết quả chắc chắn), lỗi tạm thời thử lại tối đa
// 2 lần. Cùng khoá cache giữa nút ở danh sách và mục đầy đủ ở trang sửa nên gửi ở một nơi thì nơi kia tự cập nhật.
export function useProductAppeals(shopId: string, productId: string) {
  return useQuery({
    queryKey: productAppealsQueryKey(productId),
    queryFn: () => getProductAppeals(shopId, productId),
    retry: shouldRetryQuery,
  });
}
