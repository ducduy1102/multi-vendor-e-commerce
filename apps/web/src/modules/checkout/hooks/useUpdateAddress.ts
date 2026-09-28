import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as checkoutService from '../services/checkout.service';
import type { UpdateAddressInput } from '../types';
import { addressesQueryKey } from './useAddresses';

export function useUpdateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAddressInput }) =>
      checkoutService.updateAddress(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: addressesQueryKey() });
    },
  });
}
