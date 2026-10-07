import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { sellerOrderListQueryKey } from './order-query-keys';
import { useSellerOrders } from './useSellerOrders';

vi.mock('../services/order.service', () => ({
  listSellerOrders: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useSellerOrders', () => {
  beforeEach(() => {
    vi.mocked(orderService.listSellerOrders).mockReset();
  });

  it('gọi service với shopId do page truyền xuống + tab/page, lưu dưới key gắn shopId', async () => {
    const page = { items: [], total: 0, page: 1, limit: 10 };
    vi.mocked(orderService.listSellerOrders).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { tab: 'processing' as const, page: 1 };

    const { result } = renderHook(() => useSellerOrders('shop-1', query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderService.listSellerOrders).toHaveBeenCalledWith('shop-1', query);
    expect(queryClient.getQueryData(sellerOrderListQueryKey('shop-1', query))).toEqual(page);
    expect(queryClient.getQueryData(sellerOrderListQueryKey('shop-2', query))).toBeUndefined();
  });

  it('403 (không phải chủ shop) -> báo lỗi ngay, không thử lại', async () => {
    vi.mocked(orderService.listSellerOrders).mockRejectedValue(new ApiError('Forbidden', 403));
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerOrders('shop-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(orderService.listSellerOrders).toHaveBeenCalledTimes(1);
  });
});
