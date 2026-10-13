import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { orderQueryKey } from './order-query-keys';
import { useEscalateRefundRequest } from './useEscalateRefundRequest';

vi.mock('../services/order.service', () => ({
  escalateRefundRequest: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useEscalateRefundRequest', () => {
  beforeEach(() => {
    vi.mocked(orderService.escalateRefundRequest).mockReset();
  });

  it('requestId truyền lúc mutate; thành công -> ghi đơn mới (ESCALATED) vào cache chi tiết và làm mới danh sách', async () => {
    const updated = {
      id: 'order-1',
      refundRequest: { id: 'r1', status: 'ESCALATED' },
    } as never;
    vi.mocked(orderService.escalateRefundRequest).mockResolvedValue(updated);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), {
      id: 'order-1',
      refundRequest: { id: 'r1', status: 'REJECTED_BY_SELLER' },
    });
    const { result } = renderHook(() => useEscalateRefundRequest(), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1' }));

    expect(orderService.escalateRefundRequest).toHaveBeenCalledWith('r1');
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual(updated);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
  });

  it('lỗi (quá hạn khiếu nại -> 409) -> ném lại, làm mới cả nhánh buyer để nút "Khiếu nại với sàn" biến mất', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.escalateRefundRequest).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), { id: 'order-1' });
    const { result } = renderHook(() => useEscalateRefundRequest(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ requestId: 'r1' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer'] });
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual({ id: 'order-1' });
  });
});
