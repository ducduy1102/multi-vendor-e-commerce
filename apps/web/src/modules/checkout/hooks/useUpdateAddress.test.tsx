import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import { useUpdateAddress } from './useUpdateAddress';

vi.mock('../services/checkout.service', () => ({
  updateAddress: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useUpdateAddress', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.updateAddress).mockReset();
  });

  it('sửa đúng id, xong thì làm mới danh sách địa chỉ', async () => {
    vi.mocked(checkoutService.updateAddress).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateAddress(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'address-1', input: { line1: '20 Lê Lợi' } }));

    expect(checkoutService.updateAddress).toHaveBeenCalledWith('address-1', { line1: '20 Lê Lợi' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['addresses'] });
  });
});
