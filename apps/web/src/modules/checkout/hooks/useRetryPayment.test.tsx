import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import { checkoutGroupQueryKey } from './useCheckoutGroup';
import { useRetryPayment } from './useRetryPayment';

vi.mock('../services/checkout.service', () => ({
  retryPayment: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useRetryPayment', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.retryPayment).mockReset();
  });

  it('gọi đúng groupId, xong thì làm mới ĐÚNG cache nhóm đó', async () => {
    vi.mocked(checkoutService.retryPayment).mockResolvedValue({
      paymentUrl: 'https://sandbox.vnpayment.vn/x',
      expiresAt: '2026-09-27T05:00:00.000Z',
    });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRetryPayment('group-1'), { wrapper });

    await act(() => result.current.mutateAsync());

    expect(checkoutService.retryPayment).toHaveBeenCalledWith('group-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: checkoutGroupQueryKey('group-1') });
  });
});
