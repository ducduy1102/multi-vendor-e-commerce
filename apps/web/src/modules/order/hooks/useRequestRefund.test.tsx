import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { orderListQueryKey, orderQueryKey } from './order-query-keys';
import { useRequestRefund } from './useRequestRefund';

vi.mock('../services/order.service', () => ({
  requestRefund: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useRequestRefund', () => {
  beforeEach(() => {
    vi.mocked(orderService.requestRefund).mockReset();
  });

  it('orderId truyền lúc mutate, tách khỏi body: service nhận (orderId, { reasonCode, reasonNote })', async () => {
    vi.mocked(orderService.requestRefund).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRequestRefund(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        orderId: 'order-1',
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Đổi ý',
      }),
    );

    expect(orderService.requestRefund).toHaveBeenCalledWith('order-1', {
      reasonCode: 'CHANGE_OF_MIND',
      reasonNote: 'Đổi ý',
    });
  });

  it('thành công -> ghi đơn mới (có yêu cầu vừa tạo) vào cache chi tiết và làm mới các danh sách', async () => {
    const updated = { id: 'order-1', status: 'CONFIRMED', refundRequest: { id: 'r1' } } as never;
    vi.mocked(orderService.requestRefund).mockResolvedValue(updated);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', refundRequest: null });
    queryClient.setQueryData(orderListQueryKey({ tab: 'processing' }), { items: [] });
    const { result } = renderHook(() => useRequestRefund(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ orderId: 'order-1', reasonCode: 'CHANGE_OF_MIND' }),
    );

    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual(updated);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
    expect(queryClient.getQueryState(orderListQueryKey({ tab: 'processing' }))?.isInvalidated).toBe(
      true,
    );
  });

  it('lỗi (vd 409 ALREADY_REQUESTED) -> ném lại, làm mới cả nhánh buyer (cờ đã cũ), KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.requestRefund).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1', status: 'CONFIRMED' });
    const { result } = renderHook(() => useRequestRefund(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(...)).rejects`: mẫu sau làm `act` ném lỗi TRƯỚC
    // khi `onError` kịp chạy (note-nextjs.md #37).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ orderId: 'order-1', reasonCode: 'DAMAGED' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer'] });
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual({
      id: 'order-1',
      status: 'CONFIRMED',
    });
  });
});
