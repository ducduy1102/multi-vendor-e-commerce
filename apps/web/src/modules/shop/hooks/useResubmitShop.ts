import { useMutation, useQueryClient } from '@tanstack/react-query';

import { resubmitShop } from '../services/shop.service';
import type { ResubmitShopInput } from '../types';
import { myShopQueryKey } from './useMyShop';

interface ResubmitShopVariables {
  id: string;
  values: ResubmitShopInput;
}

// Thành công: shop đã sang PENDING nên làm mới "shop của tôi" (form khoá + banner đổi). Thất bại cũng làm
// mới: lỗi thường là 409 (shop không còn REJECTED — đã nộp lại ở tab khác, hoặc Admin vừa xử lý) nên dữ liệu
// đang hiển thị đã cũ; câu lỗi "Dữ liệu đã được làm mới" chỉ đúng khi hook thật sự làm mới.
export function useResubmitShop() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: myShopQueryKey });

  return useMutation({
    mutationFn: ({ id, values }: ResubmitShopVariables) => resubmitShop(id, values),
    onSuccess: refresh,
    onError: refresh,
  });
}
