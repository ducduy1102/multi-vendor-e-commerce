import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import { addressesQueryKey } from './useAddresses';

export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => checkoutService.deleteAddress(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: addressesQueryKey() });
    },
  });
}
