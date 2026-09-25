import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as voucherService from '../services/voucher.service';
import { shopVouchersQueryKey } from './useShopVouchers';

interface SetVoucherActiveVariables {
  voucherId: string;
  isActive: boolean;
}

// Bật/tắt tường minh (idempotent) — không phải "đảo trạng thái", nên bấm
// nhanh 2 lần không làm trạng thái nhảy ngược.
export function useSetVoucherActive(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ voucherId, isActive }: SetVoucherActiveVariables) =>
      voucherService.setVoucherActive(shopId, voucherId, isActive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shopVouchersQueryKey(shopId) });
    },
  });
}
