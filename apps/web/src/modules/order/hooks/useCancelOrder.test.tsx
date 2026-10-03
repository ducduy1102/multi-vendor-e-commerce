import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { orderListQueryKey, orderQueryKey } from './order-query-keys';
import { useCancelOrder } from './useCancelOrder';

vi.mock('../services/order.service', () => ({
  cancelOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useCancelOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.cancelOrder).mockReset();
  });

  it('hủy kèm lý do, ghi đơn mới vào cache chi tiết và làm mới các danh sách', async () => {
    const cancelled = { id: 'order-1', status: 'CANCELLED' } as never;
    vi.mocked(orderService.cancelOrder).mockResolvedValue(cancelled);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', status: 'PENDING' });
    queryClient.setQueryData(orderListQueryKey({ tab: 'pending' }), { items: [] });
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1', reason: 'Đặt nhầm' }));

    expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', { reason: 'Đặt nhầm' });
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual(cancelled);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
    expect(queryClient.getQueryState(orderListQueryKey({ tab: 'pending' }))?.isInvalidated).toBe(
      true,
    );
  });

  it('lý do tuỳ chọn -> không nhập thì truyền reason undefined', async () => {
    vi.mocked(orderService.cancelOrder).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1' }));

    expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', { reason: undefined });
  });

  it('lỗi (vd 409 đã thanh toán online) -> ném lại, KHÔNG đổi cache và KHÔNG làm mới danh sách', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.cancelOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', status: 'PENDING' });
    const { result } = renderHook(() => useCancelOrder(), { wrapper });

    await expect(act(() => result.current.mutateAsync({ orderId: 'order-1' }))).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual({
      id: 'order-1',
      status: 'PENDING',
    });
  });
});
