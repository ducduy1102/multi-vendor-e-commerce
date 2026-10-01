import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as checkoutService from '../services/checkout.service';
import { useCreateAddress } from './useCreateAddress';

vi.mock('../services/checkout.service', () => ({
  createAddress: vi.fn(),
}));

const INPUT = {
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useCreateAddress', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.createAddress).mockReset();
  });

  it('tạo địa chỉ xong thì làm mới danh sách', async () => {
    vi.mocked(checkoutService.createAddress).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateAddress(), { wrapper });

    await act(() => result.current.mutateAsync(INPUT));

    expect(checkoutService.createAddress).toHaveBeenCalledWith(INPUT);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['addresses'] });
  });

  it('lỗi -> ném lại cho nơi gọi xử lý và KHÔNG làm mới danh sách', async () => {
    const error = new ApiError('Address limit reached', 409);
    vi.mocked(checkoutService.createAddress).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateAddress(), { wrapper });

    await expect(act(() => result.current.mutateAsync(INPUT))).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
