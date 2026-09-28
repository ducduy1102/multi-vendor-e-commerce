import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import { useSetDefaultAddress } from './useSetDefaultAddress';

vi.mock('../services/checkout.service', () => ({
  setDefaultAddress: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useSetDefaultAddress', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.setDefaultAddress).mockReset();
  });

  it('đặt mặc định đúng id, xong thì làm mới danh sách địa chỉ', async () => {
    vi.mocked(checkoutService.setDefaultAddress).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useSetDefaultAddress(), { wrapper });

    await act(() => result.current.mutateAsync('address-1'));

    expect(checkoutService.setDefaultAddress).toHaveBeenCalledWith('address-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['addresses'] });
  });
});
