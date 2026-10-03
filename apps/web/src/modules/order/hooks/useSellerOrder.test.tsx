import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { sellerOrderQueryKey } from './order-query-keys';
import { useSellerOrder } from './useSellerOrder';

vi.mock('../services/order.service', () => ({
  getSellerOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useSellerOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.getSellerOrder).mockReset();
  });

  it('gọi service theo shopId + orderId và lưu dưới key gắn cả hai', async () => {
    const order = { id: 'order-1', status: 'PENDING' } as never;
    vi.mocked(orderService.getSellerOrder).mockResolvedValue(order);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useSellerOrder('shop-1', 'order-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderService.getSellerOrder).toHaveBeenCalledWith('shop-1', 'order-1');
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'order-1'))).toBe(order);
  });

  it('404 (đơn shop khác/đơn chưa thanh toán/không tồn tại) -> báo lỗi ngay, không thử lại', async () => {
    vi.mocked(orderService.getSellerOrder).mockRejectedValue(
      new ApiError('Order not found', 404, 'ORDER_NOT_FOUND'),
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerOrder('shop-1', 'order-x'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(orderService.getSellerOrder).toHaveBeenCalledTimes(1);
  });
});
