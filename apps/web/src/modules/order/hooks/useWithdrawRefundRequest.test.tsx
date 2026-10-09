import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { orderListQueryKey, orderQueryKey } from './order-query-keys';
import { useWithdrawRefundRequest } from './useWithdrawRefundRequest';

vi.mock('../services/order.service', () => ({
  withdrawRefundRequest: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useWithdrawRefundRequest', () => {
  beforeEach(() => {
    vi.mocked(orderService.withdrawRefundRequest).mockReset();
  });

  it('requestId truyền lúc mutate; thành công -> ghi đơn mới (refundRequest null) vào cache chi tiết và làm mới danh sách', async () => {
    const updated = { id: 'order-1', status: 'CONFIRMED', refundRequest: null } as never;
    vi.mocked(orderService.withdrawRefundRequest).mockResolvedValue(updated);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(orderQueryKey('order-1'), {
      id: 'order-1',
      refundRequest: { id: 'r1' },
    });
    queryClient.setQueryData(orderListQueryKey({ page: 1 }), { items: [] });
    const { result } = renderHook(() => useWithdrawRefundRequest(), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1' }));

    expect(orderService.withdrawRefundRequest).toHaveBeenCalledWith('r1');
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toEqual(updated);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
  });

  it('lỗi (seller vừa trả lời -> 409) -> ném lại, làm mới cả nhánh buyer để nút "Rút yêu cầu" biến mất', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.withdrawRefundRequest).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useWithdrawRefundRequest(), { wrapper });

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
  });
});
