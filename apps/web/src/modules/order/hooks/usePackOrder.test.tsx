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

  it('lỗi -> ném lại, làm mới cả nhánh seller của shop (cờ canConfirm/... đã cũ), KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.packOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {
      id: 'order-1',
      status: 'PENDING',
    });
    const { result } = renderHook(() => usePackOrder('shop-1'), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync('order-1');
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
