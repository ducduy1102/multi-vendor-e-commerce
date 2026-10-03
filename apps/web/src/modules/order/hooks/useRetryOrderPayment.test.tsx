import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as orderService from '../services/order.service';
import { useRetryOrderPayment } from './useRetryOrderPayment';

vi.mock('../services/order.service', () => ({
  retryPayment: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useRetryOrderPayment', () => {
  beforeEach(() => {
    vi.mocked(orderService.retryPayment).mockReset();
  });

  it('gọi service theo checkoutGroupId và trả về URL cổng thanh toán, không làm mới cache (sắp rời trang)', async () => {
    const attempt = { paymentUrl: 'https://pay.example/x', expiresAt: '2026-10-03T10:00:00.000Z' };
    vi.mocked(orderService.retryPayment).mockResolvedValue(attempt);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRetryOrderPayment(), { wrapper });

    const returned = await act(() => result.current.mutateAsync('group-1'));

    expect(orderService.retryPayment).toHaveBeenCalledWith('group-1');
    expect(returned).toEqual(attempt);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('lỗi (vd 409 hết hạn giữ chỗ) -> ném lại và làm mới các danh sách đơn (cờ canRetryPayment đã cũ)', async () => {
    const error = new ApiError('Not retryable', 409, 'PAYMENT_RETRY_NOT_ALLOWED');
    vi.mocked(orderService.retryPayment).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRetryOrderPayment(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync('group-1');
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'buyer', 'list'] });
  });
});
