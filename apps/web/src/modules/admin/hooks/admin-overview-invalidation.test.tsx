import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { useDecideRefundRequest } from './useDecideRefundRequest';
import { useMarkRefundCompleted } from './useMarkRefundCompleted';
import { useRefundPayment } from './useRefundPayment';
import { useRetryRefund } from './useRetryRefund';
import { useUpdateShopStatus } from './useUpdateShopStatus';

vi.mock('../services/admin.service', () => ({
  updateShopStatus: vi.fn(),
  decideRefundRequest: vi.fn(),
  retryRefund: vi.fn(),
  markRefundCompleted: vi.fn(),
  refundPayment: vi.fn(),
}));

// Số "việc đang chờ" (nav + trang tổng quan) cùng đọc query ['admin', 'overview']. Một hành động của Admin làm một việc
// rời hàng chờ (duyệt shop, quyết định khiếu nại, thử lại / ghi nhận hoàn, hoàn thanh toán bất thường) mà quên làm mới
// query này thì huy hiệu trên nav đứng yên cho tới lần tải lại sau — không báo lỗi gì, nên cần test khoá riêng cho từng
// hook. Thất bại (thường 409: Admin khác vừa xử lý) cũng phải làm mới vì số đang hiện đã cũ.
const OVERVIEW_KEY = { queryKey: ['admin', 'overview'] };

const CASES = [
  {
    name: 'useUpdateShopStatus (duyệt / từ chối / khoá shop)',
    service: adminService.updateShopStatus,
    useHook: useUpdateShopStatus,
    variables: { shopId: 'shop-1', status: 'APPROVED' as const },
  },
  {
    name: 'useDecideRefundRequest (quyết định khiếu nại)',
    service: adminService.decideRefundRequest,
    useHook: useDecideRefundRequest,
    variables: { requestId: 'req-1', decision: 'REJECT' as const, note: 'Không đủ căn cứ' },
  },
  {
    name: 'useRetryRefund (thử lại khoản hoàn lỗi)',
    service: adminService.retryRefund,
    useHook: useRetryRefund,
    variables: { refundId: 'refund-1' },
  },
  {
    name: 'useMarkRefundCompleted (ghi nhận hoàn thủ công)',
    service: adminService.markRefundCompleted,
    useHook: useMarkRefundCompleted,
    variables: { refundId: 'refund-1', reference: 'MANUAL-1' },
  },
  {
    name: 'useRefundPayment (hoàn thanh toán bất thường)',
    service: adminService.refundPayment,
    useHook: useRefundPayment,
    variables: { paymentId: 'payment-1' },
  },
] as const;

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe.each(CASES)('$name', ({ service, useHook, variables }) => {
  beforeEach(() => {
    vi.mocked(service as (...args: never[]) => unknown).mockReset();
  });

  it('thành công -> làm mới số việc chờ của tổng quan', async () => {
    vi.mocked(service as (...args: never[]) => unknown).mockResolvedValue({});
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(
      () => (useHook as () => { mutateAsync: (v: never) => Promise<unknown> })(),
      {
        wrapper,
      },
    );

    await act(() => result.current.mutateAsync(variables as never));

    expect(invalidate).toHaveBeenCalledWith(OVERVIEW_KEY);
  });

  it('thất bại (vd 409 Admin khác vừa xử lý) -> VẪN làm mới số việc chờ (số đang hiện đã cũ)', async () => {
    vi.mocked(service as (...args: never[]) => unknown).mockRejectedValue(new Error('boom'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(
      () => (useHook as () => { mutateAsync: (v: never) => Promise<unknown> })(),
      {
        wrapper,
      },
    );

    // `act` bất đồng bộ + try/catch (xem useUpdateShopStatus.test): mẫu `expect(act(...)).rejects` làm `act` ném lỗi
    // TRƯỚC khi `onError` kịp chạy.
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(variables as never);
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(invalidate).toHaveBeenCalledWith(OVERVIEW_KEY);
  });
});
