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
import { useCancelSellerOrder } from './useCancelSellerOrder';

vi.mock('../services/order.service', () => ({
  cancelSellerOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useCancelSellerOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.cancelSellerOrder).mockReset();
  });

  it('shopId lấy lúc khai hook, orderId + lý do lúc mutate: service nhận (shopId, orderId, { reason })', async () => {
    vi.mocked(orderService.cancelSellerOrder).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCancelSellerOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1', reason: 'Hết hàng' }));

    expect(orderService.cancelSellerOrder).toHaveBeenCalledWith('shop-1', 'order-1', {
      reason: 'Hết hàng',
    });
  });

  it('thành công -> ghi đơn mới vào cache chi tiết, làm mới danh sách đơn VÀ hàng chờ yêu cầu của đúng shop đó', async () => {
    const cancelled = { id: 'order-1', status: 'CANCELLED' } as never;
    vi.mocked(orderService.cancelSellerOrder).mockResolvedValue(cancelled);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), { id: 'order-1' });
    queryClient.setQueryData(sellerOrderListQueryKey('shop-1', { tab: 'processing' }), {});
    queryClient.setQueryData(sellerRefundRequestListQueryKey('shop-1', {}), {});
    queryClient.setQueryData(sellerRefundRequestListQueryKey('shop-2', {}), {});
    const { result } = renderHook(() => useCancelSellerOrder('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'order-1', reason: 'Hết hàng' }));

    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toEqual(cancelled);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1', 'list'] });
    expect(
      queryClient.getQueryState(sellerRefundRequestListQueryKey('shop-1', {}))?.isInvalidated,
    ).toBe(true);
    // Shop khác không bị đụng tới.
    expect(
      queryClient.getQueryState(sellerRefundRequestListQueryKey('shop-2', {}))?.isInvalidated,
    ).toBe(false);
  });

  it('lỗi (vd 409 người mua vừa xin hủy/đã giao) -> ném lại, làm mới cả nhánh seller của shop, KHÔNG đổi cache chi tiết', async () => {
    const error = new Error('boom');
    vi.mocked(orderService.cancelSellerOrder).mockRejectedValue(error);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'order-1'), {
      id: 'order-1',
      status: 'PACKED',
    });
    const { result } = renderHook(() => useCancelSellerOrder('shop-1'), { wrapper });

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
      status: 'PACKED',
    });
  });
});
