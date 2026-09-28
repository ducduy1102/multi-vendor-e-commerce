import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as voucherService from '../services/voucher.service';
import type { CreateVoucherInput } from '../types';
import { shopVouchersQueryKey } from './useShopVouchers';

export function useCreateVoucher(shopId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: CreateVoucherInput) => voucherService.createVoucher(shopId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shopVouchersQueryKey(shopId) });
    },
  });
}
