import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';
import { useConfirmOrder } from './useConfirmOrder';

vi.mock('../services/order.service', () => ({
  confirmOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useConfirmOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.confirmOrder).mockReset();
  });

  it('xác nhận theo shopId + orderId, ghi đơn mới vào cache và làm mới danh sách của shop', async () => {
    const confirmed = { id: 'order-1', status: 'CONFIRMED' } as never;
    vi.mocked(orderService.confirmOrder).mockResolvedValue(confirmed);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => useConfirmOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync('order-1'));

    expect(orderService.confirmOrder).toHaveBeenCalledWith('shop-1', 'order-1');
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBe(confirmed);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1', 'list'] });
  });

  it('lỗi (vd 409 buyer vừa hủy) -> ném lại, KHÔNG làm mới danh sách', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.confirmOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => useConfirmOrder('shop-1'), { wrapper });

    await expect(act(() => result.current.mutateAsync('order-1'))).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBeUndefined();
  });
});
