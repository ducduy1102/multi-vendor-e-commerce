import { useQuery } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';

export function checkoutGroupQueryKey(groupId: string) {
  return ['checkout', 'group', groupId] as const;
}

// Trạng thái 1 nhóm thanh toán — dùng ở /checkout/result (3.6). Polling
// (refetchInterval, dừng khi trạng thái đã ổn định) là việc của 3.6, không
// thêm ở đây để tránh đoán trước hành vi chưa cần tới (YAGNI).
export function useCheckoutGroup(groupId: string) {
  return useQuery({
    queryKey: checkoutGroupQueryKey(groupId),
    queryFn: () => checkoutService.getCheckoutGroup(groupId),
    enabled: Boolean(groupId),
  });
}
