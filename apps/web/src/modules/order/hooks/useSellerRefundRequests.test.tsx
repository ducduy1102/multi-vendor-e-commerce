import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { sellerRefundRequestListQueryKey } from './order-query-keys';
import { useSellerRefundRequests } from './useSellerRefundRequests';

vi.mock('../services/order.service', () => ({
  listSellerRefundRequests: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useSellerRefundRequests', () => {
  beforeEach(() => {
    vi.mocked(orderService.listSellerRefundRequests).mockReset();
  });

  it('gọi service với shopId + bộ lọc và lưu vào đúng query key', async () => {
    const page = { items: [], total: 0, page: 1, limit: 20 };
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(
      () => useSellerRefundRequests('shop-1', { status: 'ESCALATED', page: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(orderService.listSellerRefundRequests).toHaveBeenCalledWith('shop-1', {
      status: 'ESCALATED',
      page: 2,
    });
    expect(
      queryClient.getQueryData(
        sellerRefundRequestListQueryKey('shop-1', { status: 'ESCALATED', page: 2 }),
      ),
    ).toEqual(page);
  });

  it('không truyền bộ lọc -> gọi service với {} (BE tự áp default)', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerRefundRequests('shop-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(orderService.listSellerRefundRequests).toHaveBeenCalledWith('shop-1', {});
  });

  it('lỗi 4xx (vd 403 không phải chủ shop) -> KHÔNG thử lại, vào isError ngay', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockRejectedValue(
      new ApiError('Forbidden', 403),
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerRefundRequests('shop-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(orderService.listSellerRefundRequests).toHaveBeenCalledTimes(1);
  });
});
