import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { useCancelShopOpenOrders } from './useCancelShopOpenOrders';

vi.mock('../services/admin.service', () => ({ cancelShopOpenOrders: vi.fn() }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

const EXPECTED_KEYS = [
  ['admin', 'overview'],
  ['admin', 'refunds', 'list'],
  ['admin', 'refund-requests', 'list'],
  ['admin', 'refundable-payments', 'list'],
];

describe('useCancelShopOpenOrders', () => {
  beforeEach(() => {
    vi.mocked(adminService.cancelShopOpenOrders).mockReset();
  });

  it('shopId truyền lúc mutate, tách khỏi body: service nhận (shopId, { reason })', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCancelShopOpenOrders(), { wrapper });

    await act(() => result.current.mutateAsync({ shopId: 'shop-1', reason: 'Vi phạm' }));

    expect(adminService.cancelShopOpenOrders).toHaveBeenCalledWith('shop-1', { reason: 'Vi phạm' });
  });

  it('thành công -> làm mới số việc chờ và cả ba nhánh hoàn tiền (hủy đơn tạo khoản hoàn mới)', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCancelShopOpenOrders(), { wrapper });

    await act(() => result.current.mutateAsync({ shopId: 'shop-1', reason: 'x' }));

    for (const queryKey of EXPECTED_KEYS) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('lỗi -> ném lại và VẪN làm mới (việc hủy đã làm được từng phần, dữ liệu đang hiển thị có thể đã cũ)', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockRejectedValue(new Error('boom'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCancelShopOpenOrders(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ shopId: 'shop-1', reason: 'x' });
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    for (const queryKey of EXPECTED_KEYS) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('KHÔNG làm mới danh sách shop (trạng thái shop không đổi)', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCancelShopOpenOrders(), { wrapper });

    await act(() => result.current.mutateAsync({ shopId: 'shop-1', reason: 'x' }));

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['admin', 'shops', 'list'] });
  });
});
