import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { adminRefundListQueryKey, adminRefundRequestListQueryKey } from './admin-query-keys';
import { useRetryRefund } from './useRetryRefund';

vi.mock('../services/admin.service', () => ({
  retryRefund: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useRetryRefund', () => {
  beforeEach(() => {
    vi.mocked(adminService.retryRefund).mockReset();
  });

  it('refundId truyền lúc mutate (1 hook phục vụ nút của mọi hàng)', async () => {
    vi.mocked(adminService.retryRefund).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRetryRefund(), { wrapper });

    await act(() => result.current.mutateAsync({ refundId: 'refund-1' }));

    expect(adminService.retryRefund).toHaveBeenCalledWith('refund-1');
  });

  it('thành công -> làm mới MỌI danh sách sổ cái, không đụng hàng chờ yêu cầu', async () => {
    vi.mocked(adminService.retryRefund).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }), {});
    queryClient.setQueryData(adminRefundListQueryKey({ status: 'SUCCEEDED' }), {});
    queryClient.setQueryData(adminRefundRequestListQueryKey({}), {});
    const { result } = renderHook(() => useRetryRefund(), { wrapper });

    await act(() => result.current.mutateAsync({ refundId: 'refund-1' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
    expect(
      queryClient.getQueryState(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(adminRefundListQueryKey({ status: 'SUCCEEDED' }))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(adminRefundRequestListQueryKey({}))?.isInvalidated).toBe(
      false,
    );
  });

  it('lỗi (vd 409 Admin khác vừa xử lý) -> ném lại và VẪN làm mới sổ cái', async () => {
    const error = new Error('boom');
    vi.mocked(adminService.retryRefund).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useRetryRefund(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ refundId: 'refund-1' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
  });
});
