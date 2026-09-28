import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import type { CheckoutGroup } from '../types';
import { checkoutGroupQueryKey, useCheckoutGroup } from './useCheckoutGroup';

vi.mock('../services/checkout.service', () => ({
  getCheckoutGroup: vi.fn(),
}));

const GROUP: CheckoutGroup = {
  id: 'group-1',
  status: 'AWAITING_PAYMENT',
  canRetry: true,
  expiresAt: '2026-09-27T04:15:00.000Z',
  createdAt: '2026-09-27T04:00:00.000Z',
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  latestPaymentStatus: 'PENDING',
  orders: [],
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCheckoutGroup', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.getCheckoutGroup).mockReset();
  });

  it('query key gắn theo groupId (2 nhóm không lẫn cache)', () => {
    expect(checkoutGroupQueryKey('group-1')).toEqual(['checkout', 'group', 'group-1']);
    expect(checkoutGroupQueryKey('group-2')).not.toEqual(checkoutGroupQueryKey('group-1'));
  });

  it('gọi service đúng groupId và trả về nhóm', async () => {
    vi.mocked(checkoutService.getCheckoutGroup).mockResolvedValue(GROUP);

    const { result } = renderHook(() => useCheckoutGroup('group-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(GROUP);
    expect(checkoutService.getCheckoutGroup).toHaveBeenCalledWith('group-1');
  });

  it('groupId rỗng -> không gọi service (enabled=false)', () => {
    renderHook(() => useCheckoutGroup(''), { wrapper: createWrapper() });

    expect(checkoutService.getCheckoutGroup).not.toHaveBeenCalled();
  });
});
