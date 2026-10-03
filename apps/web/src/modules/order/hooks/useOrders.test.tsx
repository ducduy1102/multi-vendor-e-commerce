import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { orderListQueryKey } from './order-query-keys';
import { useOrders } from './useOrders';

vi.mock('../services/order.service', () => ({
  listOrders: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useOrders', () => {
  beforeEach(() => {
    vi.mocked(orderService.listOrders).mockReset();
  });

  it('gọi service với đúng tab/page và lưu kết quả dưới đúng query key', async () => {
    const page = { items: [], total: 0, page: 2, limit: 10 };
    vi.mocked(orderService.listOrders).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { tab: 'pending' as const, page: 2 };

    const { result } = renderHook(() => useOrders(query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(page);
    expect(orderService.listOrders).toHaveBeenCalledWith(query);
    expect(queryClient.getQueryData(orderListQueryKey(query))).toEqual(page);
  });

  it('không truyền gì -> hỏi BE danh sách mặc định (BE tự áp tab/page/limit)', async () => {
    vi.mocked(orderService.listOrders).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => useOrders(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderService.listOrders).toHaveBeenCalledWith({});
  });

  it('đổi tab -> key khác nên gọi lại service với tab mới', async () => {
    vi.mocked(orderService.listOrders).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    const { wrapper } = setup();

    const { result, rerender } = renderHook(({ tab }) => useOrders({ tab }), {
      wrapper,
      initialProps: { tab: 'pending' as 'pending' | 'shipping' },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ tab: 'shipping' });

    await waitFor(() =>
      expect(orderService.listOrders).toHaveBeenLastCalledWith({ tab: 'shipping' }),
    );
    expect(orderService.listOrders).toHaveBeenCalledTimes(2);
  });

  it('lỗi 401 -> báo lỗi ngay, không thử lại (kết quả chắc chắn, thử lại vô ích)', async () => {
    vi.mocked(orderService.listOrders).mockRejectedValue(new ApiError('Unauthorized', 401));
    const { wrapper } = setup();

    const { result } = renderHook(() => useOrders({ tab: 'pending' }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(orderService.listOrders).toHaveBeenCalledTimes(1);
  });
});
