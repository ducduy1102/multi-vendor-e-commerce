import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import { addressesQueryKey } from './useAddresses';

export function useSetDefaultAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => checkoutService.setDefaultAddress(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: addressesQueryKey() });
    },
  });
}
