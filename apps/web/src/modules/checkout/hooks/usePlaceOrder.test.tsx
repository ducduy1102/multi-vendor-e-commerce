import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as checkoutService from '../services/checkout.service';
import { usePlaceOrder } from './usePlaceOrder';

vi.mock('../services/checkout.service', () => ({
  placeOrder: vi.fn(),
}));

const INPUT = { addressId: 'address-1', paymentMethod: 'VNPAY' as const, expectedTotal: 320000 };

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlaceOrder', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.placeOrder).mockReset();
  });

  it('truyền đúng input và Idempotency-Key xuống service', async () => {
    vi.mocked(checkoutService.placeOrder).mockResolvedValue({} as never);
    const { result } = renderHook(() => usePlaceOrder(), { wrapper });

    await act(() => result.current.mutateAsync({ input: INPUT, idempotencyKey: 'key-1' }));

    expect(checkoutService.placeOrder).toHaveBeenCalledWith(INPUT, 'key-1');
  });

  it('lỗi (vd 409 hết hàng) -> ném lại cho nơi gọi xử lý', async () => {
    const error = new ApiError('Out of stock', 409);
    vi.mocked(checkoutService.placeOrder).mockRejectedValue(error);
    const { result } = renderHook(() => usePlaceOrder(), { wrapper });

    await expect(act(() => result.current.mutateAsync({ input: INPUT }))).rejects.toBe(error);
  });
});
