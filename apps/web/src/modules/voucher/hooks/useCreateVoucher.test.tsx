import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as voucherService from '../services/voucher.service';
import { useCreateVoucher } from './useCreateVoucher';

vi.mock('../services/voucher.service', () => ({
  createVoucher: vi.fn(),
}));

const INPUT = { code: 'SALE10', type: 'PERCENT' as const, value: 10 };

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useCreateVoucher', () => {
  beforeEach(() => {
    vi.mocked(voucherService.createVoucher).mockReset();
  });

  it('tạo với đúng shopId, xong thì làm mới ĐÚNG danh sách voucher của shop đó', async () => {
    vi.mocked(voucherService.createVoucher).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateVoucher('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync(INPUT));

    expect(voucherService.createVoucher).toHaveBeenCalledWith('shop-1', INPUT);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vouchers', 'shop', 'shop-1'] });
  });

  it('lỗi (vd 409 trùng mã) -> ném lại cho nơi gọi xử lý và KHÔNG làm mới danh sách', async () => {
    const error = new ApiError('Voucher code already exists', 409);
    vi.mocked(voucherService.createVoucher).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateVoucher('shop-1'), { wrapper });

    await expect(act(() => result.current.mutateAsync(INPUT))).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
