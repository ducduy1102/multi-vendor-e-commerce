import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { orderQueryKey } from './order-query-keys';
import { useConfirmReceived } from './useConfirmReceived';

vi.mock('../services/order.service', () => ({
  confirmReceived: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useConfirmReceived', () => {
  beforeEach(() => {
    vi.mocked(orderService.confirmReceived).mockReset();
  });

  it('xác nhận theo orderId, ghi đơn COMPLETED vào cache chi tiết và làm mới các danh sách', async () => {
    const completed = { id: 'order-1', status: 'COMPLETED' } as never;
    vi.mocked(orderService.confirmReceived).mockResolvedValue(completed);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', status: 'SHIPPING' });
    const { result } = renderHook(() => useConfirmReceived(), { wrapper });

    await act(() => result.current.mutateAsync('order-1'));

    expect(orderService.confirmReceived).toHaveBeenCalledWith('order-1');
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual(completed);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
  });

  it('lỗi -> ném lại, làm mới cả nhánh buyer (cờ đã cũ), KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.confirmReceived).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', status: 'SHIPPING' });
    const { result } = renderHook(() => useConfirmReceived(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(...)).rejects`: mẫu sau làm `act` ném lỗi TRƯỚC
    // khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync('order-1');
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer'] });
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual({
      id: 'order-1',
      status: 'SHIPPING',
    });
  });
});
