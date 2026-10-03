import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';
import { useRejectOrder } from './useRejectOrder';

vi.mock('../services/order.service', () => ({
  rejectOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useRejectOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.rejectOrder).mockReset();
  });

  it('từ chối kèm lý do, ghi đơn mới vào cache và làm mới danh sách của shop', async () => {
    const rejected = { id: 'order-1', status: 'CANCELLED' } as never;
    vi.mocked(orderService.rejectOrder).mockResolvedValue(rejected);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRejectOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1', reason: 'Hết hàng' }));

    expect(orderService.rejectOrder).toHaveBeenCalledWith('shop-1', 'order-1', {
      reason: 'Hết hàng',
    });
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBe(rejected);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1', 'list'] });
  });

  it('lỗi (vd 409 đơn đã trả online) -> ném lại, KHÔNG làm mới danh sách', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.rejectOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRejectOrder('shop-1'), { wrapper });

    await expect(
      act(() => result.current.mutateAsync({ orderId: 'order-1', reason: 'x' })),
    ).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBeUndefined();
  });
});
