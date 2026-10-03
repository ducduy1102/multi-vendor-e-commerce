import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';
import { useShipOrder } from './useShipOrder';

vi.mock('../services/order.service', () => ({
  shipOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useShipOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.shipOrder).mockReset();
  });

  it('giao hàng kèm đơn vị vận chuyển/mã vận đơn, ghi đơn mới vào cache và làm mới danh sách', async () => {
    const shipping = { id: 'order-1', status: 'SHIPPING', trackingCode: 'GHN123' } as never;
    vi.mocked(orderService.shipOrder).mockResolvedValue(shipping);
    const { queryClient, wrapper, invalidate } = setup();
    const { result } = renderHook(() => useShipOrder('shop-1'), { wrapper });

    await act(() =>
      result.current.mutateAsync({ orderId: 'order-1', carrier: 'GHN', trackingCode: 'GHN123' }),
    );

    expect(orderService.shipOrder).toHaveBeenCalledWith('shop-1', 'order-1', {
      carrier: 'GHN',
      trackingCode: 'GHN123',
    });
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBe(shipping);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1', 'list'] });
  });

  it('shop tự giao (không nhập gì) -> vẫn giao được, carrier/trackingCode undefined', async () => {
    vi.mocked(orderService.shipOrder).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useShipOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1' }));

    expect(orderService.shipOrder).toHaveBeenCalledWith('shop-1', 'order-1', {
      carrier: undefined,
      trackingCode: undefined,
    });
  });

  it('lỗi -> ném lại, làm mới cả nhánh seller của shop (cờ canConfirm/... đã cũ), KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.shipOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {
      id: 'order-1',
      status: 'PENDING',
    });
    const { result } = renderHook(() => useShipOrder('shop-1'), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ orderId: 'order-1' });
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
