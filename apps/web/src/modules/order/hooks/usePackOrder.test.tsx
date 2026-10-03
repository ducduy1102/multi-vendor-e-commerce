import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';
import { usePackOrder } from './usePackOrder';

vi.mock('../services/order.service', () => ({
  packOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('usePackOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.packOrder).mockReset();
  });

  it('đóng gói theo shopId + orderId, ghi đơn mới vào cache và làm mới danh sách của shop', async () => {
    const packed = { id: 'order-1', status: 'PACKED' } as never;
    vi.mocked(orderService.packOrder).mockResolvedValue(packed);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => usePackOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync('order-1'));

    expect(orderService.packOrder).toHaveBeenCalledWith('shop-1', 'order-1');
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBe(packed);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1', 'list'] });
  });

  it('lỗi -> ném lại, KHÔNG làm mới danh sách', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.packOrder).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => usePackOrder('shop-1'), { wrapper });

    await expect(act(() => result.current.mutateAsync('order-1'))).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
