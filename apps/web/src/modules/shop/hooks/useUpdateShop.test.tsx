import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as shopService from '../services/shop.service';
import { myShopQueryKey } from './useMyShop';
import { useUpdateShop } from './useUpdateShop';

vi.mock('../services/shop.service', () => ({
  updateShop: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useUpdateShop', () => {
  beforeEach(() => {
    vi.mocked(shopService.updateShop).mockReset();
  });

  it('thành công -> làm mới "shop của tôi"', async () => {
    vi.mocked(shopService.updateShop).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateShop(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'shop-1', values: { name: 'Tên mới' } }));

    expect(shopService.updateShop).toHaveBeenCalledWith('shop-1', { name: 'Tên mới' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: myShopQueryKey });
  });

  it('thất bại (409 SHOP_EDIT_NOT_ALLOWED: shop vừa sang PENDING/SUSPENDED) -> ném lại và làm mới để form khoá đúng ngay', async () => {
    const error = new Error('409');
    vi.mocked(shopService.updateShop).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateShop(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'shop-1', values: { name: 'x' } });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: myShopQueryKey });
  });
});
