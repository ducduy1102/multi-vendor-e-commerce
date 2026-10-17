import { useMutation } from '@tanstack/react-query';

import * as accountService from '../services/account.service';
import type { ChangePasswordInput } from '../types';

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => accountService.changePassword(input),
  });
}
