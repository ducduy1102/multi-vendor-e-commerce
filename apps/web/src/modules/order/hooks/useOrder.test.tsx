import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { orderQueryKey } from './order-query-keys';
import { useOrder } from './useOrder';

vi.mock('../services/order.service', () => ({
  getOrder: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useOrder', () => {
  beforeEach(() => {
    vi.mocked(orderService.getOrder).mockReset();
  });

  it('gọi service theo id và lưu chi tiết dưới key của đúng đơn', async () => {
    const order = { id: 'order-1', status: 'PENDING' } as never;
    vi.mocked(orderService.getOrder).mockResolvedValue(order);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useOrder('order-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(order);
    expect(orderService.getOrder).toHaveBeenCalledWith('order-1');
    expect(queryClient.getQueryData(orderQueryKey('order-1'))).toBe(order);
  });

  it('404 (đơn không tồn tại hoặc của người khác) -> báo lỗi ngay, không thử lại', async () => {
    vi.mocked(orderService.getOrder).mockRejectedValue(
      new ApiError('Order not found', 404, 'ORDER_NOT_FOUND'),
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useOrder('order-x'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(orderService.getOrder).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
  });
});
