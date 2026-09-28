import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import type { CreateAddressInput } from '../types';
import { addressesQueryKey } from './useAddresses';

export function useCreateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAddressInput) => checkoutService.createAddress(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: addressesQueryKey() });
    },
  });
}
