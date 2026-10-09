import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import {
  sellerOrderListQueryKey,
  sellerOrderQueryKey,
  sellerRefundRequestListQueryKey,
} from './order-query-keys';
import { useApproveRefundRequest } from './useApproveRefundRequest';

vi.mock('../services/order.service', () => ({
  approveRefundRequest: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useApproveRefundRequest', () => {
  beforeEach(() => {
    vi.mocked(orderService.approveRefundRequest).mockReset();
  });

  it('shopId lúc khai hook, requestId + ghi chú lúc mutate: service nhận (shopId, requestId, { note })', async () => {
    vi.mocked(orderService.approveRefundRequest).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useApproveRefundRequest('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1', note: 'Đồng ý' }));

    expect(orderService.approveRefundRequest).toHaveBeenCalledWith('shop-1', 'r1', {
      note: 'Đồng ý',
    });
  });

  it('ghi chú tuỳ chọn -> không nhập thì truyền note undefined', async () => {
    vi.mocked(orderService.approveRefundRequest).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useApproveRefundRequest('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1' }));

    expect(orderService.approveRefundRequest).toHaveBeenCalledWith('shop-1', 'r1', {
      note: undefined,
    });
  });

  it('thành công -> làm mới CẢ nhánh seller của shop đó (hàng chờ + danh sách + chi tiết đơn đều đã đổi)', async () => {
    vi.mocked(orderService.approveRefundRequest).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerRefundRequestListQueryKey('shop-1', {}), {});
    queryClient.setQueryData(sellerOrderListQueryKey('shop-1', {}), {});
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {});
    queryClient.setQueryData(sellerOrderQueryKey('shop-2', 'order-1'), {});
    const { result } = renderHook(() => useApproveRefundRequest('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
    for (const key of [
      sellerRefundRequestListQueryKey('shop-1', {}),
      sellerOrderListQueryKey('shop-1', {}),
      sellerOrderQueryKey('shop-1', 'order-1'),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(sellerOrderQueryKey('shop-2', 'order-1'))?.isInvalidated).toBe(
      false,
    );
  });

  it('lỗi (vd 409 người mua vừa rút) -> ném lại và VẪN làm mới cả nhánh seller (dữ liệu đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.approveRefundRequest).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useApproveRefundRequest('shop-1'), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ requestId: 'r1' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
  });
});
