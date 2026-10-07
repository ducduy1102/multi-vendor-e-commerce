import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as shopService from '../services/shop.service';
import { myShopQueryKey } from './useMyShop';
import { useResubmitShop } from './useResubmitShop';

vi.mock('../services/shop.service', () => ({
  resubmitShop: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useResubmitShop', () => {
  beforeEach(() => {
    vi.mocked(shopService.resubmitShop).mockReset();
  });

  it('gọi service với (id, values) — id truyền lúc mutate', async () => {
    vi.mocked(shopService.resubmitShop).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useResubmitShop(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'shop-1', values: { name: 'Tên đã sửa' } }));

    expect(shopService.resubmitShop).toHaveBeenCalledWith('shop-1', { name: 'Tên đã sửa' });
  });

  it('thành công -> làm mới "shop của tôi" (shop đã sang PENDING nên form khoá + banner đổi)', async () => {
    vi.mocked(shopService.resubmitShop).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useResubmitShop(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'shop-1', values: {} }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: myShopQueryKey });
  });

  it('thất bại (vd 409 đã nộp lại ở tab khác) -> ném lại và VẪN làm mới (câu lỗi hứa "dữ liệu đã được làm mới")', async () => {
    const error = new Error('409');
    vi.mocked(shopService.resubmitShop).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useResubmitShop(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(...)).rejects`: mẫu sau làm `act` ném lỗi TRƯỚC
    // khi `onError` kịp chạy.
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'shop-1', values: {} });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: myShopQueryKey });
  });
});
