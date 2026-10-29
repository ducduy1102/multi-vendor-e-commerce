import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createShopAppeal } from '../services/appeal.service';
import { shopAppealsQueryKey } from './appeal-query-keys';

// Thành công hay thất bại đều làm mới lịch sử: thành công thì kháng nghị mới đã có và `canAppeal` thành false; thất bại
// (thường là 409 — Admin vừa mở khoá shop, hoặc đã gửi ở tab khác) thì dữ liệu đang hiển thị đã cũ, và câu lỗi "dữ liệu đã được
// làm mới" chỉ đúng khi hook thật sự làm mới.
export function useCreateShopAppeal(shopId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: shopAppealsQueryKey(shopId) });

  return useMutation({
    mutationFn: (message: string) => createShopAppeal(shopId, { message }),
    onSuccess: refresh,
    onError: refresh,
  });
}
