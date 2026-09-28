import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as voucherService from '../services/voucher.service';
import { useSetVoucherActive } from './useSetVoucherActive';

vi.mock('../services/voucher.service', () => ({
  setVoucherActive: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useSetVoucherActive', () => {
  beforeEach(() => {
    vi.mocked(voucherService.setVoucherActive).mockReset();
  });

  it.each([true, false])(
    'đặt isActive=%s tường minh (không đảo trạng thái) rồi làm mới danh sách của shop',
    async (isActive) => {
      vi.mocked(voucherService.setVoucherActive).mockResolvedValue({} as never);
      const { wrapper, invalidate } = setup();
      const { result } = renderHook(() => useSetVoucherActive('shop-1'), { wrapper });

      await act(() => result.current.mutateAsync({ voucherId: 'voucher-1', isActive }));

      expect(voucherService.setVoucherActive).toHaveBeenCalledWith('shop-1', 'voucher-1', isActive);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vouchers', 'shop', 'shop-1'] });
    },
  );

  it('lỗi -> ném lại và KHÔNG làm mới danh sách (giữ nguyên trạng thái hiển thị)', async () => {
    const error = new Error('boom');
    vi.mocked(voucherService.setVoucherActive).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useSetVoucherActive('shop-1'), { wrapper });

    await expect(
      act(() => result.current.mutateAsync({ voucherId: 'voucher-1', isActive: false })),
    ).rejects.toBe(error);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
