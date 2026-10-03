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

  it('lỗi (vd 409 đơn đã trả online) -> ném lại, làm mới cả nhánh seller của shop (cờ canConfirm/... đã cũ), KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.rejectOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {
      id: 'order-1',
      status: 'PENDING',
    });
    const { result } = renderHook(() => useRejectOrder('shop-1'), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ orderId: 'order-1', reason: 'x' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toEqual({
      id: 'order-1',
      status: 'PENDING',
    });
  });
});
