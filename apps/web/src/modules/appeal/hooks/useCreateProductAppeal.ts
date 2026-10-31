import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createProductAppeal } from '../services/appeal.service';
import { productAppealsQueryKey } from './appeal-query-keys';

// Như `useCreateShopAppeal`: thành công hay thất bại đều làm mới lịch sử — thành công thì kháng nghị mới đã có và `canAppeal` thành false;
// thất bại (thường là 409 — Admin vừa khôi phục sản phẩm, hoặc đã gửi ở tab khác) thì dữ liệu đang hiển thị đã cũ, và câu lỗi "dữ liệu đã
// được làm mới" chỉ đúng khi hook thật sự làm mới.
export function useCreateProductAppeal(shopId: string, productId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: productAppealsQueryKey(productId) });

  return useMutation({
    mutationFn: (message: string) => createProductAppeal(shopId, productId, { message }),
    onSuccess: refresh,
    onError: refresh,
  });
}
