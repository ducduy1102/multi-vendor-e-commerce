import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as reviewService from '../services/review.service';
import { sellerReviewListQueryKey } from './review-query-keys';
import { useSellerReviews } from './useSellerReviews';

vi.mock('../services/review.service', () => ({
  listShopReviews: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useSellerReviews', () => {
  beforeEach(() => {
    vi.mocked(reviewService.listShopReviews).mockReset();
  });

  it('gọi service với shopId + bộ lọc và lưu vào đúng query key', async () => {
    const page = { items: [], total: 0, page: 1, limit: 10 };
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useSellerReviews('shop-1', { replied: 'false', page: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(reviewService.listShopReviews).toHaveBeenCalledWith('shop-1', {
      replied: 'false',
      page: 2,
    });
    expect(
      queryClient.getQueryData(sellerReviewListQueryKey('shop-1', { replied: 'false', page: 2 })),
    ).toEqual(page);
  });

  it('không truyền bộ lọc -> gọi service với {} (BE tự áp default)', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerReviews('shop-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(reviewService.listShopReviews).toHaveBeenCalledWith('shop-1', {});
  });

  it('lỗi 4xx (vd 403 không phải chủ shop) -> KHÔNG thử lại, vào isError ngay', async () => {
    vi.mocked(reviewService.listShopReviews).mockRejectedValue(new ApiError('Forbidden', 403));
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerReviews('shop-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(reviewService.listShopReviews).toHaveBeenCalledTimes(1);
  });

  it('lỗi tạm thời (5xx) -> thử lại tối đa 2 lần (tổng 3 lần gọi)', async () => {
    vi.mocked(reviewService.listShopReviews).mockRejectedValue(new ApiError('boom', 500));
    const { wrapper } = setup();

    const { result } = renderHook(() => useSellerReviews('shop-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });

    expect(reviewService.listShopReviews).toHaveBeenCalledTimes(3);
  });
});
