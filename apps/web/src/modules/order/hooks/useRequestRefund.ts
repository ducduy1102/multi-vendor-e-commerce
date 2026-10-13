import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as orderService from '../services/order.service';
import type { CreateRefundRequestInput } from '../types';
import { syncBuyerOrder } from './order-cache';
import { buyerOrdersQueryKey } from './order-query-keys';

interface RequestRefundVariables extends CreateRefundRequestInput {
  orderId: string;
}

// Gửi yêu cầu hủy (đơn CONFIRMED/PACKED) hoặc trả hàng/hoàn tiền (đơn COMPLETED trong cửa sổ). orderId
// truyền lúc mutate, tách khỏi body: service nhận (orderId, { reasonCode, reasonNote }). Loại yêu cầu do BE
// suy từ trạng thái đơn. Lỗi 409 (REFUND_REQUEST_NOT_ALLOWED: quá hạn, đã có yêu cầu...; ORDER_ALREADY_CHANGED)
// để component dịch theo `code` qua useDescribeOrderError.
export function useRequestRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, ...input }: RequestRefundVariables) =>
      orderService.requestRefund(orderId, input),
    onSuccess: (order) => syncBuyerOrder(queryClient, order),
    // Lỗi thường là đơn/yêu cầu vừa đổi ở nơi khác nên cờ canRequestCancel/canRequestReturn đang hiển thị
    // đã cũ — làm mới cả danh sách lẫn chi tiết để nút đúng ngay, thay vì để người mua bấm lại và nhận lại
    // đúng lỗi đó (note-nextjs.md #36).
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: buyerOrdersQueryKey() });
    },
  });
}
