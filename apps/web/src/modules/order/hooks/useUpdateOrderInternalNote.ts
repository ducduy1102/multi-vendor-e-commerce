import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey, sellerOrdersQueryKey } from './order-query-keys';

interface UpdateOrderInternalNoteVariables {
  orderId: string;
  // Chuỗi rỗng = xoá ghi chú (BE lưu NULL).
  note: string;
}

// Đặt / sửa / xoá ghi chú nội bộ của shop trên đơn (Week11.md 4.4). BE trả CHI TIẾT đơn mới nhất nên ghi thẳng vào cache chi tiết
// (khớp với bản BE vừa chuẩn hoá: cắt khoảng trắng, xuống dòng LF). KHÔNG làm mới danh sách đơn: ghi chú không nằm ở danh sách và không
// đổi trạng thái hay tiền của đơn. Lỗi (thường là 404: đơn vừa biến mất khỏi tầm nhìn của shop) thì làm mới cả nhánh seller của shop
// để màn hình đang hiển thị không giữ dữ liệu cũ.
export function useUpdateOrderInternalNote(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, note }: UpdateOrderInternalNoteVariables) =>
      orderService.updateOrderInternalNote(shopId, orderId, { note }),
    onSuccess: (order) => {
      queryClient.setQueryData(sellerOrderQueryKey(shopId, order.id), order);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: sellerOrdersQueryKey(shopId) });
    },
  });
}
