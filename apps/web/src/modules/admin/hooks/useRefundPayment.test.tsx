import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import {
  adminRefundListQueryKey,
  adminRefundRequestListQueryKey,
  adminRefundablePaymentListQueryKey,
} from './admin-query-keys';
import { useRefundPayment } from './useRefundPayment';

vi.mock('../services/admin.service', () => ({
  refundPayment: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useRefundPayment', () => {
  beforeEach(() => {
    vi.mocked(adminService.refundPayment).mockReset();
  });

  it('paymentId truyền lúc mutate, tách khỏi body: service nhận (paymentId, { reason })', async () => {
    vi.mocked(adminService.refundPayment).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRefundPayment(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ paymentId: 'payment-2', reason: 'Khách trả hai lần' }),
    );

    expect(adminService.refundPayment).toHaveBeenCalledWith('payment-2', {
      reason: 'Khách trả hai lần',
    });
  });

  it('lý do tuỳ chọn -> không nhập thì truyền reason undefined', async () => {
    vi.mocked(adminService.refundPayment).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRefundPayment(), { wrapper });

    await act(() => result.current.mutateAsync({ paymentId: 'payment-2' }));

    expect(adminService.refundPayment).toHaveBeenCalledWith('payment-2', { reason: undefined });
  });

  it('thành công -> làm mới danh sách thanh toán bất thường VÀ sổ cái, không đụng hàng chờ yêu cầu', async () => {
    vi.mocked(adminService.refundPayment).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(adminRefundablePaymentListQueryKey({}), {});
    queryClient.setQueryData(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }), {});
    queryClient.setQueryData(adminRefundRequestListQueryKey({}), {});
    const { result } = renderHook(() => useRefundPayment(), { wrapper });

    await act(() => result.current.mutateAsync({ paymentId: 'payment-2' }));

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['admin', 'refundable-payments', 'list'],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
    expect(queryClient.getQueryState(adminRefundablePaymentListQueryKey({}))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(adminRefundRequestListQueryKey({}))?.isInvalidated).toBe(
      false,
    );
  });

  it('lỗi (vd 409 PAYMENT_NOT_REFUNDABLE — Admin khác vừa hoàn) -> ném lại và VẪN làm mới cả hai danh sách', async () => {
    const error = new Error('boom');
    vi.mocked(adminService.refundPayment).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRefundPayment(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ paymentId: 'payment-2' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['admin', 'refundable-payments', 'list'],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
  });
});
