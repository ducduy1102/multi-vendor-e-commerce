import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey, sellerRefundRequestListQueryKey } from './order-query-keys';
import { useRejectRefundRequest } from './useRejectRefundRequest';

vi.mock('../services/order.service', () => ({
  rejectRefundRequest: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useRejectRefundRequest', () => {
  beforeEach(() => {
    vi.mocked(orderService.rejectRefundRequest).mockReset();
  });

  it('shopId lúc khai hook, requestId + ghi chú lúc mutate: service nhận (shopId, requestId, { note })', async () => {
    vi.mocked(orderService.rejectRefundRequest).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRejectRefundRequest('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1', note: 'Hàng đã gửi' }));

    expect(orderService.rejectRefundRequest).toHaveBeenCalledWith('shop-1', 'r1', {
      note: 'Hàng đã gửi',
    });
  });

  it('thành công -> làm mới cả nhánh seller của shop (cờ canApprove/canReject nằm cả trong chi tiết đơn)', async () => {
    vi.mocked(orderService.rejectRefundRequest).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerRefundRequestListQueryKey('shop-1', {}), {});
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {});
    const { result } = renderHook(() => useRejectRefundRequest('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1', note: 'x' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
    expect(
      queryClient.getQueryState(sellerRefundRequestListQueryKey('shop-1', {}))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(sellerOrderQueryKey('shop-1', 'order-1'))?.isInvalidated).toBe(
      true,
    );
  });

  it('lỗi -> ném lại và VẪN làm mới cả nhánh seller', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.rejectRefundRequest).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRejectRefundRequest('shop-1'), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ requestId: 'r1', note: 'x' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
  });
});
