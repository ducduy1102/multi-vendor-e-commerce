import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { cartQueryKeys } from '@/modules/cart';

// Làm mới giỏ hàng ĐÚNG 1 LẦN khi `isReady` chuyển sang true. BE xoá các dòng vừa mua khỏi giỏ ngay
// lúc đặt hàng (mọi phương thức), nhưng cache giỏ ở client (biểu tượng giỏ trên Header/BottomTabBar,
// trang /cart) vẫn giữ dữ liệu cũ: đơn online tải lại cả trang khi quay về từ cổng thanh toán nên tự
// đúng, còn đơn COD đi bằng điều hướng trong ứng dụng (không tải lại trang) nên phải tự làm mới.
//
// Chặn gọi lại bằng useRef (rules/frontend.md mục 8): isReady đổi qua lại hoặc StrictMode chạy effect
// 2 lần không được sinh thêm lần làm mới nào. Cố ý không phụ thuộc vào trạng thái cụ thể của nhóm
// (PAID/COD_PLACED/AWAITING_PAYMENT…) — giỏ đã được xoá bất kể trạng thái nào.
export function useRefreshCartOnce(isReady: boolean) {
  const queryClient = useQueryClient();
  const hasRefreshedRef = useRef(false);

  useEffect(() => {
    if (isReady && !hasRefreshedRef.current) {
      hasRefreshedRef.current = true;
      void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
    }
  }, [isReady, queryClient]);
}
